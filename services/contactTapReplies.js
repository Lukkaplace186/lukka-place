/**
 * services/contactTapReplies.js
 *
 * What an agent TYPES after "Un client vous contacte" (owner, 2026-11-20).
 *
 * Measured 2026-11-15 → 20: of 81 alerts, agents pressed a button on 28, and
 * several answered in words instead — "C'est disponible", "Bsr oui c'est
 * disponible", "Nous nous sommes fixés pour une visite aujourd'hui",
 * "Donné moi les images ou le texte svp". Some believed the alert WAS the
 * customer. None of it was recorded, and nobody answered them.
 *
 * Within 24 h of an alert, a short text from the alerted number (no media,
 * ≤ 200 characters, no other question of ours open on that number) is read:
 *
 *   visit    "visite", "rdv", "fixé", or a day + hour  → « Visite fixée »
 *            (services/directVisit.js: the visit, confirmed at once when the
 *            text carries the day and the hour, else « Quand ? »)
 *   gone     "déjà loué", "plus disponible", "vendu"…  → a reply, and
 *            « Retirer l'annonce du site ? » Oui / Non
 *   nothing  "rien reçu", "pas de message"…           → « Rien reçu »
 *   available "disponible", "dispo", "libre"…          → « J'ai répondu », and
 *            the listing's availability confirmed today (the public badge)
 *
 * The first classified reply, and any unclassified short text, also tells the
 * agent ONCE per alert that this number is Lukka Place's: the customer cannot
 * see it, and must be answered on the agent's own WhatsApp. An unclassified
 * text still falls through to ordinary processing (it may be a question for
 * us); a classified one is consumed. A bare "ok" is an acknowledgement of
 * whatever we sent last and is never read as an answer.
 */

const dbService = require('./db');
const propertyRepository = require('./propertyRepository');
const { HEADER_BRAND, THANKS } = require('./contactTapAlert');
const { parseFrenchSlot } = require('./visitSchedule');

/** How long after an alert a typed reply is read as about it. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Longer is an advert or a conversation, not an answer. */
const MAX_REPLY_TEXT = 200;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function fold(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const GONE = /\b(deja (loue|louee|vendu|vendue|pris|prise|occupe|occupee)|n'est plus (disponible|libre)|plus disponible|n'est plus|plus libre|indisponible|deja attribue|a ete (loue|vendu))\b|\b(loue|louee|vendu|vendue)\b/;
const NOTHING = /\b(rien recu|pas recu|rien reçu|aucun message|pas de message|personne (ne )?m'a|pas encore recu|il ne m'a pas (ecrit|appele)|aucun appel)\b/;
const VISIT = /\b(visite|visiter|rdv|rendez[- ]vous|fixe|fixee|fixes|fixees|programme|programmee|on se voit|on s'est fixe)\b/;
const AVAILABLE = /\b(disponible|dispo|libre|toujours (la|libre|disponible)|c'est bon)\b/;
const ADVERT = /(\$|\busd\b|\bfc\b|dollars?\b|\bchambres?\b|\bsalon\b|\bparcelle\b|\bappartement\b|\bstudio\b|\bm2\b|\bm²|\bdimension|\bgarantie\b|\bloyer\b|\bprix\b|\ba (louer|vendre)\b|\bcommune\b|\bquartier\b|\bref\b|\breference\b)/;

/**
 * @param {string} text what the agent typed
 * @param {Date} [now]
 * @returns {'visit'|'gone'|'nothing'|'available'|null}
 */
function classifyAgentReply(text, now = new Date()) {
  const t = fold(text);
  if (!t || t.length > MAX_REPLY_TEXT) return null;
  // A short advert ("Appartement disponible à Gombe 600$, visite 10$") is
  // listing intake, never an answer: money or property words end it here.
  if (ADVERT.test(t)) return null;
  // Most specific first: "plus disponible" also contains "disponible".
  if (GONE.test(t)) return 'gone';
  if (NOTHING.test(t)) return 'nothing';
  if (VISIT.test(t) || parseFrenchSlot(text, now)) return 'visit';
  if (AVAILABLE.test(t)) return 'available';
  return null;
}

const CLARIFY_TEXT = [
  `${HEADER_BRAND} ℹ️ Ce numéro est celui de Lukka Place, pas celui du client : il ne voit pas ce message.`,
  'Répondez-lui sur votre propre WhatsApp (il vous y écrit), puis dites-nous ici où vous en êtes.',
].join('\n');

const GONE_ASK = `${HEADER_BRAND} Le bien n'est plus disponible ? Nous pouvons retirer l'annonce du site pour que d'autres clients ne vous écrivent plus.`;

function goneButtons(alertId) {
  return [
    { id: `contact_tap_off:${alertId}`, title: "✅ Oui, retirer" },
    { id: `contact_tap_keep:${alertId}`, title: '↩️ Non, la garder' },
  ];
}

async function send(to, text, label) {
  try {
    // eslint-disable-next-line global-require
    await require('./chakra').sendWhatsAppMessage(to, text);
    return true;
  } catch (err) {
    console.error(`[contact-tap-reply] ${label} to ${to} failed: ${err.message}`);
    return false;
  }
}

/** Stamp the listing's availability as confirmed today (Postgres, the agent's own live listing). */
async function confirmAvailability(alert) {
  try {
    // eslint-disable-next-line global-require
    const pool = require('./postgres').getPool?.();
    if (!pool || !alert.agent_id) return false;
    const { rowCount } = await pool.query(
      `UPDATE properties SET availability_confirmed_at = NOW()
        WHERE id = $1 AND agent_id = $2 AND status = 1 AND approve_status = 1
          AND listing_status IS DISTINCT FROM 'closed'`,
      [Number(alert.property_id), Number(alert.agent_id)],
    );
    return rowCount > 0;
  } catch (err) {
    // 42703 before the column exists: the answer still counts.
    console.error(`[contact-tap-reply] availability stamp for listing #${alert.property_id} failed: ${err.message}`);
    return false;
  }
}

/**
 * A typed reply from an agent, read against their latest alert. Never throws.
 * @returns {Promise<{handled: boolean, kind?: string, alertId?: number}>}
 */
async function handleContactTapTextReply({ from, text, hasMedia = false, now = new Date() }) {
  try {
    if (hasMedia || !text || String(text).length > MAX_REPLY_TEXT) return { handled: false };
    const wa = digits(from);
    // Another question of ours is open on this number: its handler had the
    // first look, and nothing here may answer it in its place.
    if (dbService.hasOpenAgentQuestion(wa)) return { handled: false };

    // « Quand a lieu la visite ? » first: "demain 10h" answers it.
    // eslint-disable-next-line global-require
    const timed = await require('./directVisit').handleVisitTimeReply({ from: wa, text, now });
    if (timed.handled) return { handled: true, kind: 'visit-time', viewingRequestId: timed.viewingRequestId };

    const alert = dbService.latestContactTapAlertTo(wa, new Date(now.getTime() - REPLY_WINDOW_MS).toISOString());
    if (!alert) return { handled: false };
    const kind = classifyAgentReply(text, now);

    const clarifyOnce = async () => {
      if (dbService.markContactTapClarified(alert.id, now.toISOString())) await send(wa, CLARIFY_TEXT, 'clarification');
    };

    if (!kind) {
      // Only soon after the alert: hours later the text is about something else.
      if (now.getTime() - Date.parse(alert.created_at) <= 6 * 60 * 60 * 1000) await clarifyOnce();
      return { handled: false };
    }

    if (kind === 'visit') {
      dbService.answerContactTapAlert(alert.id, 'VISIT_SET', now.toISOString());
      // eslint-disable-next-line global-require
      const visit = await require('./directVisit').onVisitSet(alert, { from: wa, text, now });
      await clarifyOnce();
      console.log(`[contact-tap-reply] alert #${alert.id}: typed visit → visit #${visit.viewingRequestId || '—'} (confirmed: ${Boolean(visit.confirmed)})`);
      return { handled: true, kind, alertId: alert.id };
    }

    if (kind === 'gone') {
      dbService.answerContactTapAlert(alert.id, 'REPLIED', now.toISOString());
      dbService.recordContactTapOutcome(alert.id, 'CLOSED', 'WHATSAPP_TEXT', now.toISOString());
      try {
        // eslint-disable-next-line global-require
        await require('./chakra').sendInteractiveButtons(wa, GONE_ASK, goneButtons(alert.id));
      } catch (err) {
        console.warn(`[contact-tap-reply] alert #${alert.id}: take-off question not sent (${err.message})`);
      }
      await clarifyOnce();
      return { handled: true, kind, alertId: alert.id };
    }

    if (kind === 'nothing') {
      dbService.answerContactTapAlert(alert.id, 'NOTHING', now.toISOString());
      await send(wa, THANKS.NOTHING, 'thanks');
      return { handled: true, kind, alertId: alert.id };
    }

    // available
    dbService.answerContactTapAlert(alert.id, 'REPLIED', now.toISOString());
    const stamped = await confirmAvailability(alert);
    await send(wa, `${HEADER_BRAND} Merci, c'est noté${stamped ? ' : l’annonce est marquée « disponibilité confirmée » sur le site' : ''}. 🙏`, 'thanks');
    await clarifyOnce();
    return { handled: true, kind, alertId: alert.id };
  } catch (err) {
    console.error(`[contact-tap-reply] reply from ${from} failed: ${err.message}`);
    return { handled: false };
  }
}

/** `contact_tap_off:12` / `contact_tap_keep:12`, or null. */
function parseGoneButtonId(replyId) {
  const match = /^contact_tap_(off|keep):(\d+)$/.exec(String(replyId || '').trim());
  return match ? { takeOff: match[1] === 'off', alertId: Number.parseInt(match[2], 10) } : null;
}

/**
 * « Retirer l'annonce ? » Oui / Non. Only the alerted number; the listing is
 * closed only for its own agent (postgres.closeListingFromAgent), else marked
 * under offer.
 */
async function handleGoneButtonReply({ from, replyId }) {
  const parsed = parseGoneButtonId(replyId);
  if (!parsed) return { handled: false };
  const alert = dbService.getContactTapAlert(parsed.alertId);
  if (!alert) return { handled: true, ignored: 'unknown-alert' };
  if (digits(from) !== digits(alert.agent_wa)) return { handled: true, ignored: 'not-this-agent' };
  if (!parsed.takeOff) {
    await send(digits(from), `${HEADER_BRAND} D'accord, l'annonce reste en ligne.`, 'keep listing');
    return { handled: true, takeOff: false };
  }
  // eslint-disable-next-line global-require
  const pg = require('./postgres');
  let closed = false;
  let underOffer = false;
  try {
    closed = await pg.closeListingFromAgent(alert.property_id, alert.agent_id);
    if (!closed) underOffer = await pg.markPropertyUnderOffer(alert.property_id);
  } catch (err) {
    console.error(`[contact-tap-reply] listing #${alert.property_id} take-off failed: ${err.message}`);
  }
  const listing = await propertyRepository.getListingContactById(alert.property_id).catch(() => null);
  await send(
    digits(from),
    closed || underOffer
      ? `${HEADER_BRAND} C'est fait : l'annonce n° ${alert.property_id} ${closed ? 'est retirée du site (louée / vendue)' : 'est marquée « sous offre »'}. Merci ! Pensez à nous dire le prix conclu dans « Faites le point ».`
      : `${HEADER_BRAND} Nous n'avons pas pu retirer l'annonce n° ${alert.property_id}. Faites-le depuis votre espace, onglet Mes biens.`,
    'take-off result',
  );
  console.log(`[contact-tap-reply] alert #${alert.id}: listing #${alert.property_id} ${closed ? 'closed' : underOffer ? 'under offer' : 'NOT changed'}${listing ? '' : ' (no longer public)'}`);
  return { handled: true, takeOff: true, closed, underOffer };
}

module.exports = {
  classifyAgentReply,
  handleContactTapTextReply,
  handleGoneButtonReply,
  parseGoneButtonId,
  CLARIFY_TEXT,
  REPLY_WINDOW_MS,
};
