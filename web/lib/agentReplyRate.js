/**
 * "Vous nous avez confirmé avoir répondu à 4 clients sur 10" (2026-11-21,
 * owner: of 109 contacts agents were alerted about since 2026-11-09, 31 were
 * answered, 13 "Rien reçu", 65 nothing — and a customer who gets no reply
 * does not come back). Pure: the agent overview card, /admin/agents/[id], the
 * agents list column and tests/unit/agent-reply-rate.test.js share it.
 *
 * WHAT THE NUMBER IS. The engine's per-agent counts (GET
 * /admin/contact-taps/reply-rates, db.contactTapReplyRates) over the "Un client
 * vous contacte" alerts that left in the window: `replied` = the agent told us
 * they answered (« J'ai répondu », « Visite fixée », a typed "disponible" or
 * visit reply, an outcome on "Faites le point"); `nothing` = « Rien reçu ».
 * The customer writes to the agent's own WhatsApp, which we never see, so the
 * wording always says "confirmé" / "a répondu à l'alerte", never "a écrit au
 * client" — and an unanswered alert is "sans réponse à notre alerte", not
 * "client ignoré".
 *
 * No rate from a tiny sample: below MIN_ALERTS alerts the agent sees nothing
 * and the console shows the raw counts only.
 */

export const REPLY_RATE_WINDOW_DAYS = 30;
export const MIN_ALERTS = 3;

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** ISO start of the window ending at `now`. */
export function replyRateSince(now = new Date(), days = REPLY_RATE_WINDOW_DAYS) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * One engine row → the figures, or null when there is no row. `enough` is
 * false under MIN_ALERTS: then no rate is shown anywhere.
 *
 * @param {{alerted?: number, replied?: number, nothing?: number}|null|undefined} row
 * @returns {{alerted: number, replied: number, nothing: number, silent: number, percent: number|null, enough: boolean}|null}
 */
export function replyRateSummary(row) {
  if (!row) return null;
  const alerted = count(row.alerted);
  if (alerted === 0) return null;
  const replied = Math.min(count(row.replied), alerted);
  const nothing = Math.min(count(row.nothing), alerted - replied);
  const enough = alerted >= MIN_ALERTS;
  return {
    alerted,
    replied,
    nothing,
    silent: alerted - replied - nothing,
    percent: enough ? Math.round((replied / alerted) * 100) : null,
    enough,
  };
}

/** French counts 0 and 1 as singular; English only 1. */
const plural = (n, one, many) => (n <= 1 ? one : many);
const pluralEn = (n, one, many) => (n === 1 ? one : many);

const COPY = {
  fr: {
    title: 'Vos réponses aux clients',
    headline: (s) => `Vous nous avez confirmé avoir répondu à ${s.replied} ${plural(s.replied, 'client', 'clients')} sur ${s.alerted} ces ${REPLY_RATE_WINDOW_DAYS} derniers jours.`,
    rest: (s) => {
      const parts = [];
      if (s.nothing) parts.push(`${s.nothing} « Rien reçu »`);
      if (s.silent) parts.push(`${s.silent} sans réponse à notre alerte`);
      return parts.length ? `Les autres : ${parts.join(', ')}.` : null;
    },
    why: 'Un client qui n’a pas de réponse rapide ne revient pas : il écrit à une autre agence.',
    todo: 'Répondez-lui dans l’heure, puis touchez « J’ai répondu » sous notre message « Un client vous contacte » : nous ne voyons pas vos conversations WhatsApp, c’est la seule façon de savoir que vous l’avez fait.',
    allDone: 'Bravo : continuez à toucher « J’ai répondu » sous chaque alerte.',
  },
  en: {
    title: 'Your replies to customers',
    headline: (s) => `You confirmed replying to ${s.replied} ${pluralEn(s.replied, 'customer', 'customers')} out of ${s.alerted} in the last ${REPLY_RATE_WINDOW_DAYS} days.`,
    rest: (s) => {
      const parts = [];
      if (s.nothing) parts.push(`${s.nothing} “nothing received”`);
      if (s.silent) parts.push(`${s.silent} with no answer to our alert`);
      return parts.length ? `The others: ${parts.join(', ')}.` : null;
    },
    why: 'A customer who gets no quick reply does not come back: they write to another agency.',
    todo: 'Reply within the hour, then tap “J’ai répondu” under our “Un client vous contacte” message: we cannot see your WhatsApp chats, so this is the only way we know you did.',
    allDone: 'Well done: keep tapping “J’ai répondu” under every alert.',
  },
};

/**
 * What the agent's card says, or null when nothing should be shown (no
 * alerts, or fewer than MIN_ALERTS).
 */
export function agentReplyRateCopy(summary, locale = 'fr') {
  if (!summary?.enough) return null;
  const copy = COPY[locale === 'en' ? 'en' : 'fr'];
  return {
    title: copy.title,
    headline: copy.headline(summary),
    rest: copy.rest(summary),
    why: copy.why,
    todo: summary.replied === summary.alerted ? copy.allDone : copy.todo,
  };
}

/**
 * The console's wording (French, like the rest of the agent profile's
 * engine-derived facts): "A confirmé une réponse à 4 alertes sur 10 (40 %)",
 * or the raw counts under MIN_ALERTS, or "Aucune alerte" when none left.
 */
export function adminReplyRateLine(summary) {
  if (!summary) return `Aucune alerte « Un client vous contacte » ces ${REPLY_RATE_WINDOW_DAYS} jours.`;
  const head = `A confirmé avoir répondu à ${summary.replied} ${plural(summary.replied, 'alerte', 'alertes')} sur ${summary.alerted}`;
  const rest = [
    summary.nothing ? `${summary.nothing} « Rien reçu »` : null,
    summary.silent ? `${summary.silent} sans réponse` : null,
  ].filter(Boolean).join(', ');
  const rate = summary.enough ? ` (${summary.percent} %)` : ` — moins de ${MIN_ALERTS} alertes, pas de taux`;
  return `${head}${rate}${rest ? ` · ${rest}` : ''}.`;
}

export const ADMIN_REPLY_RATE_TITLE = `Réponses aux alertes « Un client vous contacte » (${REPLY_RATE_WINDOW_DAYS} jours)`;
export const ADMIN_REPLY_RATE_NOTE = 'La parole de l’agent à notre alerte (bouton, réponse écrite ou « Faites le point ») : nous ne voyons pas sa conversation WhatsApp avec le client.';

/** The agents list cell: "4/10 · 40 %", "1/2" (no rate), or null (no alert). */
export function replyRateCell(summary) {
  if (!summary) return null;
  return {
    text: `${summary.replied}/${summary.alerted}${summary.enough ? ` · ${summary.percent} %` : ''}`,
    low: summary.enough && summary.percent < 50,
  };
}
