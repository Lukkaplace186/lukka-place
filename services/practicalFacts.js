/**
 * services/practicalFacts.js
 *
 * The "fiche pratique" — power, water, access in the rainy season, visit fee —
 * as an agent answered it on WhatsApp.
 *
 * NOTHING IS ASKED ANY MORE (owner, 2026-11-12). The questions were sent as
 * reply buttons right after the publish receipt on "OK" for a few hours on
 * 2026-11-12; the owner removed them the same day: after "OK" the agent gets
 * the receipt and nothing else. Don't add a question after "OK" without the
 * owner — every extra step puts off commissionnaires who are already hesitant.
 *
 * What remains:
 * - A tap on a button still sitting in an agent's chat
 *   (`fiche:<listing>:<c|e|a|f>:<value>`) is saved and acknowledged once
 *   ("Merci, c'est noté"); no further question follows. Without this the tap
 *   would fall through to the assistant as an unknown message.
 * - The answers already given stay on the listing (SQLite and `properties`)
 *   and on the listing page's "Fiche pratique" card: they are the agent's own
 *   facts. NULL is "not stated", never a default.
 * - An answer ADDS the matching utility codes (services/utilities.js) and the
 *   generator / solar ticks, so the existing filters see it. Only the number
 *   that sent the listing may answer; a building pasted as units gets the
 *   answer on every unit.
 *
 * Values are DUPLICATED in web/lib/practicalFacts.js and in the CHECKs of
 * migrations/20261112_listing_practical_facts.sql — change all three together
 * (web/tests/unit/practical-facts.test.js compares them).
 */

const { db, getListing } = require('./db');
const chakra = require('./chakra');
const { normaliseUtilities } = require('./utilities');

const POWER_SUPPLY = Object.freeze(['snel', 'snel_groupe', 'snel_solaire']);
const WATER_SUPPLY = Object.freeze(['regideso', 'regideso_citerne', 'forage']);
const RAINY_ACCESS = Object.freeze(['bon', 'difficile', 'inonde']);
const VISIT_FEE = Object.freeze(['non', 'oui']);

/** The button-id key of each old question → its column and accepted answers. */
const ANSWER_KEYS = Object.freeze({
  c: { field: 'power_supply', values: POWER_SUPPLY },
  e: { field: 'water_supply', values: WATER_SUPPLY },
  a: { field: 'rainy_access', values: RAINY_ACCESS },
  f: { field: 'visit_fee', values: VISIT_FEE },
});

const THANKS_TEXT = 'Merci, c’est noté ✅';

const ID_PATTERN = /^fiche:(\d{1,12}):([ceaf]):([a-z_]{2,20})$/;

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** `{ listingId, field, value }` or null for anything that is not ours or not valid. */
function parseButtonId(replyId) {
  const match = ID_PATTERN.exec(String(replyId || ''));
  if (!match) return null;
  const key = ANSWER_KEYS[match[2]];
  if (!key || !key.values.includes(match[3])) return null;
  return { listingId: Number(match[1]), field: key.field, value: match[3] };
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

/** Mirror the rows' answers onto their Postgres properties. Never throws. */
async function mirrorToPostgres(rows) {
  const pg = require('./postgres');
  if (!pg.isConfigured()) return;
  for (const row of rows) {
    if (!row.remote_property_id) {
      console.warn(`[fiche] listing #${row.id} not synced yet — answer kept in SQLite, the publish sync carries it`);
      continue;
    }
    try {
      await pg.updatePracticalFacts(row.remote_property_id, row);
    } catch (err) {
      console.error(`[fiche] mirroring listing #${row.id} to property #${row.remote_property_id} failed: ${err.message}`);
    }
  }
}

/**
 * A tap on an old fiche button. `{ handled: false }` for any id that is not
 * ours, so the webhook moves on to the next handler. Saves the answer and
 * thanks the agent; never asks another question.
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

  const rows = saveAnswer(idsForAnswer(row), parsed.field, parsed.value, now);
  console.log(`[fiche] listing #${row.id}: ${parsed.field} = ${parsed.value} (${rows.length} row(s)) — old button, nothing more asked`);
  mirrorToPostgres(rows).catch((err) => console.error(`[fiche] mirror failed: ${err.message}`));

  try {
    await chakra.sendWhatsAppMessage(digits(from), THANKS_TEXT, { previewUrl: false });
    console.log(`[fiche] thanked ${from} for listing #${row.id}`);
    return { handled: true, action: 'saved' };
  } catch (err) {
    console.error(`[fiche] thanks to ${from} for listing #${row.id} failed: ${err.message}`);
    return { handled: true, action: 'saved-not-told' };
  }
}

module.exports = {
  POWER_SUPPLY,
  WATER_SUPPLY,
  RAINY_ACCESS,
  VISIT_FEE,
  THANKS_TEXT,
  parseButtonId,
  impliedFacts,
  factsOf,
  saveAnswer,
  handlePracticalButtonReply,
};
