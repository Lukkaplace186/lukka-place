/**
 * services/practicalFacts.js
 *
 * The "fiche pratique": four questions asked on WhatsApp right after an agent
 * sends a listing with "OK" (owner decision 2026-11-12) — power, water, access
 * in the rainy season, and whether the agency charges a visit fee. Each answer
 * is one tap on a reply button; nothing is typed, so nothing is guessed.
 *
 * WHY
 * ---
 * The storefront's "Électricité" and "Eau" filters had almost nothing to filter
 * on: power and water are what a Kinshasa tenant asks first, and agents rarely
 * write them in the advert. A structured answer from the agent is the only way
 * to get them without inventing them.
 *
 * Rules
 * -----
 * - NULL is "not stated". An agent who stops answering leaves the rest NULL;
 *   the listing page then shows nothing for them, never a default.
 * - An answer also adds the matching utility codes (services/utilities.js) and
 *   the generator / solar ticks, so the existing filters pick it up. It only
 *   ever ADDS: "SNEL seulement" removes nothing an agent already stated.
 * - Only the number that sent the listing may answer for it.
 * - Asked after the publish receipt, fire-and-forget: a failure here never
 *   costs the agent the receipt. Not asked for bare land, for several
 *   unrelated properties pasted together (each would need its own answers),
 *   or when FICHE_PRATIQUE=off.
 * - A building pasted as several units (one parent_building_id) is asked once;
 *   each answer is written to every unit, since power, water and the road
 *   belong to the address.
 *
 * Values are DUPLICATED in web/lib/practicalFacts.js and in the CHECKs of
 * migrations/20261112_listing_practical_facts.sql — change all three together
 * (web/tests/unit/practical-facts.test.js compares them).
 */

const { db, getListing } = require('./db');
const chakra = require('./chakra');
const { normaliseUtilities } = require('./utilities');
const { isLandOnly } = require('./listingDetails');

const POWER_SUPPLY = Object.freeze(['snel', 'snel_groupe', 'snel_solaire']);
const WATER_SUPPLY = Object.freeze(['regideso', 'regideso_citerne', 'forage']);
const RAINY_ACCESS = Object.freeze(['bon', 'difficile', 'inonde']);
const VISIT_FEE = Object.freeze(['non', 'oui']);

const INTRO = 'Quatre questions rapides pour la *fiche pratique* de votre annonce, une touche par réponse. '
  + 'Les clients nous les demandent avant tout.';

/**
 * In the order they are asked. `key` is the short code in a button id (ids
 * must stay short; Meta caps a reply id at 256 characters). Button titles are
 * at most 20 characters (WhatsApp's limit, checked by chakra).
 */
const QUESTIONS = Object.freeze([
  {
    key: 'c',
    field: 'power_supply',
    text: '*1 sur 4 · Le courant ?*',
    answers: [
      { value: 'snel', title: 'SNEL seulement' },
      { value: 'snel_groupe', title: 'SNEL + groupe' },
      { value: 'snel_solaire', title: 'SNEL + solaire' },
    ],
  },
  {
    key: 'e',
    field: 'water_supply',
    text: "*2 sur 4 · L'eau ?*",
    answers: [
      { value: 'regideso', title: 'REGIDESO' },
      { value: 'regideso_citerne', title: 'REGIDESO + citerne' },
      { value: 'forage', title: 'Forage ou puits' },
    ],
  },
  {
    key: 'a',
    field: 'rainy_access',
    text: "*3 sur 4 · En saison des pluies, l'accès au bien ?*",
    answers: [
      { value: 'bon', title: 'Bon accès' },
      { value: 'difficile', title: 'Difficile' },
      { value: 'inonde', title: 'Route inondée' },
    ],
  },
  {
    key: 'f',
    field: 'visit_fee',
    text: '*4 sur 4 · Demandez-vous des frais de visite ?*',
    answers: [
      { value: 'non', title: 'Non, gratuite' },
      { value: 'oui', title: 'Oui, payante' },
    ],
  },
]);

const DONE_TEXT = 'Merci ! La fiche pratique est enregistrée ✅ Elle s’affichera sur votre annonce dès sa mise en ligne.';
const UPDATED_TEXT = 'Réponse mise à jour ✅';

const ID_PATTERN = /^fiche:(\d{1,12}):([ceaf]):([a-z_]{2,20})$/;

/** Kill switch, read at call time. */
function practicalFactsEnabled() {
  return String(process.env.FICHE_PRATIQUE || '').trim().toLowerCase() !== 'off';
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function buttonId(listingId, questionKey, value) {
  return `fiche:${listingId}:${questionKey}:${value}`;
}

/** `{ listingId, question, value }` or null for anything that is not ours or not valid. */
function parseButtonId(replyId) {
  const match = ID_PATTERN.exec(String(replyId || ''));
  if (!match) return null;
  const question = QUESTIONS.find((q) => q.key === match[2]);
  if (!question || !question.answers.some((a) => a.value === match[3])) return null;
  return { listingId: Number(match[1]), question, value: match[3] };
}

/** The value as stored: visit_fee is a boolean (0 / 1 in SQLite), the rest text. */
function storedValue(field, value) {
  if (field === 'visit_fee') return value === 'oui';
  return value;
}

/**
 * What an answer implies for the existing structured fields, so the filters
 * and badges that already read them pick it up. Adds only — never a removal.
 */
function impliedFacts(field, value) {
  const out = { utilities: [], has_generator: null, has_solar: null };
  if (field === 'power_supply') {
    if (value === 'snel_groupe') { out.utilities.push('groupe'); out.has_generator = true; }
    if (value === 'snel_solaire') { out.utilities.push('solaire'); out.has_solar = true; }
  } else if (field === 'water_supply') {
    if (value === 'regideso') out.utilities.push('regideso');
    if (value === 'regideso_citerne') out.utilities.push('regideso', 'citerne');
    if (value === 'forage') out.utilities.push('forage');
  } else if (field === 'rainy_access' && value === 'bon') {
    out.utilities.push('acces_facile');
  }
  return out;
}

/** The answers on a SQLite row, in the shape the web reads (visit_fee boolean or null). */
function factsOf(row) {
  if (!row) return { power_supply: null, water_supply: null, rainy_access: null, visit_fee: null };
  return {
    power_supply: POWER_SUPPLY.includes(row.power_supply) ? row.power_supply : null,
    water_supply: WATER_SUPPLY.includes(row.water_supply) ? row.water_supply : null,
    rainy_access: RAINY_ACCESS.includes(row.rainy_access) ? row.rainy_access : null,
    visit_fee: row.visit_fee === null || row.visit_fee === undefined ? null : Boolean(row.visit_fee),
  };
}

/** The first question this row has no answer for, or null when all four are answered. */
function nextQuestion(row) {
  const facts = factsOf(row);
  return QUESTIONS.find((q) => facts[q.field] === null) || null;
}

/** Whether to ask at all for this listing. */
function shouldAsk(row) {
  if (!practicalFactsEnabled() || !row) return false;
  if (isLandOnly(row.property_type, row.parcelle_subtype)) return false;
  return nextQuestion(row) !== null;
}

/** The listing ids an answer is written to: the whole building, or just this one. */
function idsForAnswer(row) {
  if (!row?.parent_building_id) return [row.id];
  return db.prepare('SELECT id FROM listings WHERE parent_building_id = ? ORDER BY id').all(row.parent_building_id).map((r) => r.id);
}

/**
 * Write one answer to SQLite (every id), merging the implied utility codes and
 * ticks. Returns the rows after the write.
 */
function saveAnswer(ids, field, value, now = new Date()) {
  const implied = impliedFacts(field, value);
  const stored = storedValue(field, value);
  const write = db.transaction(() => {
    for (const id of ids) {
      const row = getListing(id);
      if (!row) continue;
      const utilities = normaliseUtilities([...(row.utilities || []), ...implied.utilities]);
      db.prepare(
        `UPDATE listings SET ${field} = ?, utilities = ?,
           has_generator = CASE WHEN ? = 1 THEN 1 ELSE has_generator END,
           has_solar = CASE WHEN ? = 1 THEN 1 ELSE has_solar END,
           practical_answered_at = ?
         WHERE id = ?`,
      ).run(
        typeof stored === 'boolean' ? (stored ? 1 : 0) : stored,
        JSON.stringify(utilities),
        implied.has_generator ? 1 : 0,
        implied.has_solar ? 1 : 0,
        now.toISOString(),
        id,
      );
    }
  });
  write();
  return ids.map((id) => getListing(id)).filter(Boolean);
}

/**
 * Mirror the rows' answers onto their Postgres properties. A row not synced
 * yet is retried once a little later (the publish sync usually lands within a
 * second, an agent's tap rarely before it). Never throws.
 */
async function mirrorToPostgres(rows, { retried = false } = {}) {
  const pg = require('./postgres');
  if (!pg.isConfigured()) return;
  const pending = [];
  for (const row of rows) {
    if (!row.remote_property_id) {
      pending.push(row.id);
      continue;
    }
    try {
      await pg.updatePracticalFacts(row.remote_property_id, row);
    } catch (err) {
      console.error(`[fiche] mirroring listing #${row.id} to property #${row.remote_property_id} failed: ${err.message}`);
    }
  }
  if (pending.length && !retried) {
    const timer = setTimeout(() => {
      const fresh = pending.map((id) => getListing(id)).filter(Boolean);
      mirrorToPostgres(fresh, { retried: true }).catch(() => {});
    }, 20000);
    if (typeof timer.unref === 'function') timer.unref();
  } else if (pending.length) {
    console.warn(`[fiche] listing(s) ${pending.join(', ')} still not synced — answers kept in SQLite, the publish sync carries them`);
  }
}

async function sendQuestion(to, row, question, { intro = false } = {}) {
  const text = intro ? `${INTRO}\n\n${question.text}` : question.text;
  const buttons = question.answers.map((a) => ({ id: buttonId(row.id, question.key, a.value), title: a.title }));
  await chakra.sendInteractiveButtons(digits(to), text, buttons);
  console.log(`[fiche] asked '${question.field}' for listing #${row.id} to ${to}`);
}

/**
 * After the publish receipt. `ids` are the listings the "OK" published.
 * Fire-and-forget: logs, never throws.
 */
async function askAfterPublish(ids, to) {
  try {
    if (!practicalFactsEnabled()) return { asked: false, reason: 'off' };
    const rows = (Array.isArray(ids) ? ids : []).map((id) => getListing(id)).filter(Boolean);
    if (!rows.length) return { asked: false, reason: 'no-listing' };
    if (rows.length > 1) {
      const building = rows[0].parent_building_id;
      if (!building || rows.some((r) => r.parent_building_id !== building)) {
        return { asked: false, reason: 'several-properties' };
      }
    }
    const row = rows[0];
    if (!shouldAsk(row)) return { asked: false, reason: 'nothing-to-ask' };
    await sendQuestion(to, row, nextQuestion(row), { intro: true });
    return { asked: true, listingId: row.id };
  } catch (err) {
    console.error(`[fiche] could not ask for listings ${JSON.stringify(ids)} (to ${to}): ${err.message}`);
    return { asked: false, reason: 'send-failed' };
  }
}

/**
 * A tapped answer. `{ handled: false }` for any id that is not ours, so the
 * webhook moves on to the next handler.
 */
async function handlePracticalButtonReply({ from, replyId, now = new Date() }) {
  const parsed = parseButtonId(replyId);
  if (!parsed) return { handled: false };
  const row = getListing(parsed.listingId);
  if (!row || digits(row.wa_id) !== digits(from)) {
    // Silently: answering a stranger would confirm the listing id is real.
    console.warn(`[fiche] '${replyId}' from ${from} refused — ${row ? 'not the sender' : 'unknown listing'}`);
    return { handled: true, ignored: row ? 'not-sender' : 'unknown-listing' };
  }

  const wasComplete = nextQuestion(row) === null;
  const rows = saveAnswer(idsForAnswer(row), parsed.question.field, parsed.value, now);
  console.log(`[fiche] listing #${row.id}: ${parsed.question.field} = ${parsed.value} (${rows.length} row(s))`);
  mirrorToPostgres(rows).catch((err) => console.error(`[fiche] mirror failed: ${err.message}`));

  const fresh = rows.find((r) => r.id === row.id) || row;
  const next = nextQuestion(fresh);
  try {
    if (next) {
      await sendQuestion(from, fresh, next);
      return { handled: true, action: 'asked-next', field: next.field };
    }
    await chakra.sendWhatsAppMessage(digits(from), wasComplete ? UPDATED_TEXT : DONE_TEXT, { previewUrl: false });
    console.log(`[fiche] listing #${row.id} ${wasComplete ? 'answer updated' : 'fiche complete'} — told ${from}`);
    return { handled: true, action: wasComplete ? 'updated' : 'complete' };
  } catch (err) {
    console.error(`[fiche] follow-up to ${from} for listing #${row.id} failed: ${err.message}`);
    return { handled: true, action: 'saved-not-told' };
  }
}

module.exports = {
  POWER_SUPPLY,
  WATER_SUPPLY,
  RAINY_ACCESS,
  VISIT_FEE,
  QUESTIONS,
  DONE_TEXT,
  UPDATED_TEXT,
  practicalFactsEnabled,
  buttonId,
  parseButtonId,
  impliedFacts,
  factsOf,
  nextQuestion,
  shouldAsk,
  saveAnswer,
  askAfterPublish,
  handlePracticalButtonReply,
};
