/**
 * services/db.js
 *
 * Local SQLite persistence for parsed listings.
 *
 * better-sqlite3 is synchronous by design — calls block the event loop but
 * complete in microseconds, which is far cheaper than the async overhead at this
 * write volume. Inserts happen after the webhook has already been acknowledged,
 * so nothing latency-sensitive is waiting on them.
 */

const path = require('path');
const Database = require('better-sqlite3');

// DB_PATH lets tests point at a scratch file instead of the real database.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db');

const db = new Database(DB_PATH);

// WAL keeps readers from blocking on the writer — needed once an admin
// dashboard reads this file while the webhook is still inserting. It is a
// persistent property of the database file, so re-applying it is a no-op.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Columns present since the first version of the table. These carry
 * constraints (PRIMARY KEY, NOT NULL) that SQLite cannot retrofit with
 * ALTER TABLE, so they are only ever created, never migrated.
 */
const BASE_COLUMNS = [
  ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
  ['wa_id', 'TEXT NOT NULL'],
  ['agent_name', 'TEXT'],
  ['intent', 'TEXT'],
  ['transaction_type', 'TEXT'],
  ['property_type', 'TEXT'],
  ['commune', 'TEXT'],
  ['quartier', 'TEXT'],
  ['price', 'REAL'],
  ['currency', 'TEXT'],
  ['raw_text', 'TEXT'],
  ['created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'],
];

/**
 * Everything added after v1. Declared once and used for BOTH the CREATE TABLE
 * (fresh databases) and the ALTER TABLE migration (databases created before
 * these columns existed) — one list, so the two paths can never drift apart.
 *
 * Every entry must be nullable with no NOT NULL constraint: that is what makes
 * it safe to add to a table that already holds rows.
 */
const EXTENDED_COLUMNS = [
  // WhatsApp message id (wamid...). Uniqueness is enforced by a unique INDEX
  // rather than a column constraint: SQLite's ALTER TABLE ADD COLUMN refuses a
  // UNIQUE column outright, so declaring it inline would break the migration
  // path for databases that already exist. A unique index is equivalent here,
  // and it treats NULLs as distinct — so rows saved without a wamid (legacy
  // rows, manual inserts) never collide with each other.
  ['wamid', 'TEXT'],
  // Every wamid that fed this listing, as a JSON array. A photo burst arrives as
  // several messages but becomes one row, so `wamid` alone would leave the
  // non-primary ids undeduplicated and a redelivery of photo #3 would create a
  // second listing.
  ['group_wamids', 'TEXT'],
  ['bedrooms', 'INTEGER'],
  ['bathrooms', 'INTEGER'],
  ['surface_area_sqm', 'REAL'],
  // Sub-classification of a 'parcelle' property_type ('maison_type_locataire' /
  // 'villa' / 'terrain_nu') — see services/openai.js's PARCELLE_SUBTYPES.
  ['parcelle_subtype', 'TEXT'],
  // "X Portes" / "Type Locataire" — a multi-unit rental compound's door count.
  ['units_count', 'INTEGER'],
  // The listing's own "Réf:"/"Référence:" code from the raw text, distinct
  // from `quartier` (a place, not an identifier).
  ['reference', 'TEXT'],
  ['price_period', 'TEXT'],
  ['deposit_months', 'INTEGER'],
  // SQLite has no BOOLEAN type — stored as 0 / 1 / NULL.
  ['furnished', 'INTEGER'],
  // JSON arrays, queryable in place via json_extract() / json_each().
  ['amenities', 'TEXT'],
  ['summary_fr', 'TEXT'],
  ['missing_fields', 'TEXT'],
  // Complete aiParser output, so no future field is ever lost to the schema.
  ['parsed_json', 'TEXT'],
  // Web paths of downloaded photos (services/mediaStorage.js), as a JSON array —
  // same pattern as amenities/missing_fields. Populated once the images survive
  // the Chakra download; a caption-only listing simply has an empty array.
  ['photos', 'TEXT'],
  // Multi-turn confirmation state: a freshly extracted listing starts here and
  // waits for the agent to reply 'OK'/'Oui' before it counts as published. See
  // findLatestPendingListing / publishListing / applyListingCorrection below.
  ['status', "TEXT DEFAULT 'pending_confirmation'"],
  // Unused: an earlier sync attempt (services/mysql.js) targeted the wrong
  // database entirely and was removed. Left in place rather than dropped —
  // this table only ever gains columns, never loses them. See
  // remote_property_id below for the column actually in use.
  ['mysql_property_id', 'INTEGER'],
  // Supabase Postgres `properties.id` once this listing has been synced
  // there (services/postgres.js) — lets a later re-sync UPDATE instead of
  // inserting a duplicate row on the website's side.
  ['remote_property_id', 'INTEGER'],
];

const ALL_COLUMNS = [...BASE_COLUMNS, ...EXTENDED_COLUMNS];

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    ${ALL_COLUMNS.map(([name, type]) => `${name} ${type}`).join(',\n    ')}
  );
`);

/**
 * Bring a pre-existing table up to the current schema.
 *
 * SQLite's ALTER TABLE ADD COLUMN is cheap (metadata only — it does not rewrite
 * existing rows) and non-destructive: old rows simply read NULL for the new
 * column. Adding a column that already exists is an error rather than a no-op,
 * so check table_info first. Idempotent — a no-op on an up-to-date database.
 */
function migrate() {
  const existing = new Set(
    db.prepare('PRAGMA table_info(listings)').all().map((column) => column.name),
  );

  // One-off rename, pre-dating the commune/quartier taxonomy (kinshasa_locations.json):
  // this column held the exact same "finer landmark within a commune" data under
  // the English name. SQLite's RENAME COLUMN preserves every existing row.
  if (existing.has('neighborhood') && !existing.has('quartier')) {
    db.exec('ALTER TABLE listings RENAME COLUMN neighborhood TO quartier');
    existing.delete('neighborhood');
    existing.add('quartier');
    console.log('[db] schema migrated — renamed column neighborhood -> quartier');
  }

  const missing = EXTENDED_COLUMNS.filter(([name]) => !existing.has(name));
  if (missing.length === 0) {
    return [];
  }

  // All-or-nothing: a half-migrated table would break the prepared INSERT below.
  db.transaction(() => {
    for (const [name, type] of missing) {
      db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${type}`);
    }
  })();

  const added = missing.map(([name]) => name);
  console.log(`[db] schema migrated — added column(s): ${added.join(', ')}`);
  return added;
}

migrate();

// Pre-dates the commune/quartier taxonomy — same column, new requested index
// name. DROP+CREATE rather than a second redundant index on the same column.
db.exec('DROP INDEX IF EXISTS idx_listings_commune');

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_wamid ON listings (wamid);

  CREATE INDEX IF NOT EXISTS idx_listings_wa_id      ON listings (wa_id);
  CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings (created_at);
  CREATE INDEX IF NOT EXISTS idx_commune             ON listings (commune);
  CREATE INDEX IF NOT EXISTS idx_quartier            ON listings (quartier);
  CREATE INDEX IF NOT EXISTS idx_listings_price      ON listings (price);
  CREATE INDEX IF NOT EXISTS idx_listings_bedrooms   ON listings (bedrooms);
  CREATE INDEX IF NOT EXISTS idx_listings_wa_status  ON listings (wa_id, status);
  CREATE INDEX IF NOT EXISTS idx_listings_remote_property_id ON listings (remote_property_id);
`);

// ---------------------------------------------------------------------------
// Kinshasa location master data — commune/quartier reference tables.
//
// Denormalised copies of the resolved names still live directly on `listings`
// (commune/quartier columns above) since that is this table's existing
// pattern throughout; these two tables exist as the queryable, canonical
// source the fuzzy resolver (services/locations.js) and any future admin UI
// validate against, not as a foreign-key constraint on `listings` — an agent's
// raw text is free-form and a name outside the list must still be storable.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS communes (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS quartiers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    commune_id INTEGER NOT NULL REFERENCES communes (id),
    name       TEXT NOT NULL,
    UNIQUE (commune_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_quartiers_commune_id ON quartiers (commune_id);
`);

/**
 * Load kinshasa_locations.json into the `communes` / `quartiers` tables, once.
 * Idempotent: a populated `communes` table means this has already run, so a
 * restart never re-seeds or duplicates rows.
 */
function seedLocations() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM communes').get();
  if (count > 0) return;

  const { LOCATIONS } = require('./locations');
  const insertCommune = db.prepare('INSERT INTO communes (name) VALUES (?)');
  const insertQuartier = db.prepare('INSERT INTO quartiers (commune_id, name) VALUES (?, ?)');

  const communeCount = db.transaction(() => {
    let communes = 0;
    for (const [commune, quartiers] of Object.entries(LOCATIONS)) {
      const { lastInsertRowid: communeId } = insertCommune.run(commune);
      communes += 1;
      for (const quartier of quartiers) {
        insertQuartier.run(communeId, quartier);
      }
    }
    return communes;
  })();

  console.log(`[db] seeded ${communeCount} communes / quartiers from kinshasa_locations.json`);
}

seedLocations();

// ---------------------------------------------------------------------------
// Value coercion
//
// better-sqlite3 only binds numbers, bigints, strings, buffers and null — it
// throws on undefined, booleans, arrays and objects, all of which the parser
// produces routinely. Everything below funnels values into a bindable type.
// ---------------------------------------------------------------------------

/** Absent or blank -> NULL. */
function toNullable(value) {
  return value === undefined || value === null || value === '' ? null : value;
}

/** Numeric, or NULL. Tolerates the model returning a numeric string. */
function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Whole number, or NULL — for bedrooms/bathrooms/deposit_months. */
function toInteger(value) {
  const number = toNumber(value);
  return number === null ? null : Math.round(number);
}

/** true/false -> 1/0, anything absent -> NULL (distinct from "not furnished"). */
function toSqliteBool(value) {
  if (value === undefined || value === null || value === '') return null;
  return value ? 1 : 0;
}

/**
 * Arrays -> JSON text. Strings pass through so a caller can hand over
 * pre-serialised JSON or a plain comma-separated list.
 */
function toJsonText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Prepared once and reused — re-preparing per insert would re-parse the SQL on
 * every message.
 */
const INSERT_FIELDS = ALL_COLUMNS.map(([name]) => name).filter(
  (name) => name !== 'id' && name !== 'created_at',
);

const insertListingStmt = db.prepare(`
  INSERT INTO listings (${INSERT_FIELDS.join(', ')})
  VALUES (${INSERT_FIELDS.map((name) => `@${name}`).join(', ')})
`);

/**
 * Persist one parsed listing.
 *
 * Idempotent when a `wamid` is supplied: a redelivered message hits the unique
 * index and returns the row already on file instead of inserting a second copy.
 *
 * @param {Object} listingData  Result of `aiParser.parseListing()`.
 * @param {Object} senderInfo
 * @param {string} senderInfo.waId        Sender's WhatsApp id (E.164, no '+').
 * @param {string} [senderInfo.wamid]     Inbound message id, for deduplication.
 * @param {string[]} [senderInfo.groupWamids] Every wamid merged into this row.
 * @param {string} [senderInfo.agentName] WhatsApp profile name.
 * @param {string} [senderInfo.rawText]   Original message text / image caption.
 * @param {string} [senderInfo.status]    Defaults to 'pending_confirmation' — every
 *        new listing waits for the agent's 'OK' before it counts as published.
 * @param {string[]} [senderInfo.photos]  Web paths of downloaded photos (services/mediaStorage.js).
 * @returns {{id: number, createdAt: string, duplicate: boolean}}
 *          `duplicate` is true when this wamid was already stored; `id` then
 *          points at the existing row.
 */
function saveListing(listingData, senderInfo = {}) {
  const { waId, wamid, groupWamids, agentName, rawText, status, photos } = senderInfo;

  if (!waId) {
    throw new Error('saveListing requires senderInfo.waId');
  }
  if (!listingData) {
    throw new Error('saveListing requires listingData');
  }

  let info;
  try {
    info = insertListingStmt.run({
      wa_id: String(waId),
      wamid: toNullable(wamid),
      group_wamids: toJsonText(
        Array.isArray(groupWamids) && groupWamids.length ? groupWamids : undefined,
      ),
      agent_name: toNullable(agentName),
      intent: toNullable(listingData.intent),
      transaction_type: toNullable(listingData.transaction_type),
      property_type: toNullable(listingData.property_type),
      commune: toNullable(listingData.commune),
      quartier: toNullable(listingData.quartier),
      price: toNumber(listingData.price),
      currency: toNullable(listingData.currency),
      raw_text: toNullable(rawText),

      bedrooms: toInteger(listingData.bedrooms),
      bathrooms: toInteger(listingData.bathrooms),
      surface_area_sqm: toNumber(listingData.surface_area_sqm),
      parcelle_subtype: toNullable(listingData.parcelle_subtype),
      units_count: toInteger(listingData.units_count),
      reference: toNullable(listingData.reference),
      price_period: toNullable(listingData.price_period),
      deposit_months: toInteger(listingData.deposit_months),
      furnished: toSqliteBool(listingData.furnished),
      amenities: toJsonText(listingData.amenities),
      summary_fr: toNullable(listingData.summary_fr),
      missing_fields: toJsonText(listingData.missing_fields),
      parsed_json: toJsonText(listingData),
      status: toNullable(status) || 'pending_confirmation',
      photos: toJsonText(Array.isArray(photos) && photos.length ? photos : undefined),
      mysql_property_id: null,
      // Set only once services/postgres.js confirms the sync — see publishListing.
      remote_property_id: null,
    });
  } catch (err) {
    // Match only the wamid collision. A blanket INSERT OR IGNORE would also
    // swallow genuine failures (a NULL wa_id, a corrupt file) as silent no-ops.
    const isDuplicateWamid =
      err.code === 'SQLITE_CONSTRAINT_UNIQUE' && String(err.message).includes('listings.wamid');

    if (!isDuplicateWamid) {
      throw err;
    }

    const existing = db
      .prepare('SELECT id, created_at FROM listings WHERE wamid = ?')
      .get(String(wamid));

    return { id: existing.id, createdAt: existing.created_at, duplicate: true };
  }

  const id = Number(info.lastInsertRowid);
  const { created_at: createdAt } = db
    .prepare('SELECT created_at FROM listings WHERE id = ?')
    .get(id);

  return { id, createdAt, duplicate: false };
}

/**
 * Save the `extracted_data` object returned by services/openai.js.
 *
 * A thin adapter over `saveListing` with the argument order the Chakra pipeline
 * uses. Field names already match the table, so nothing is remapped here —
 * `saveListing` does the null/boolean/JSON coercion.
 *
 * @param {Object} extractedData  `extracted_data` from openai.parseMessage().
 * @param {string} senderPhone    Agent's number (E.164, no '+').
 * @param {Object} [extra]
 * @param {string} [extra.wamid]        Inbound message id, for deduplication.
 * @param {string[]} [extra.groupWamids] Every wamid merged into this listing.
 * @param {string} [extra.agentName]    Sender's display name, if the provider sends one.
 * @param {string} [extra.rawText]      Original message text.
 * @param {string[]} [extra.photos]     Web paths of downloaded photos (services/mediaStorage.js).
 * @returns {{id: number, createdAt: string, duplicate: boolean}}
 */
function insertListing(extractedData, senderPhone, extra = {}) {
  if (!extractedData) {
    throw new Error('insertListing requires extractedData');
  }
  if (!senderPhone) {
    throw new Error('insertListing requires senderPhone');
  }

  return saveListing(extractedData, {
    waId: senderPhone,
    wamid: extra.wamid,
    groupWamids: extra.groupWamids,
    agentName: extra.agentName,
    rawText: extra.rawText,
    status: extra.status,
    photos: extra.photos,
  });
}

/**
 * Has this WhatsApp message already been stored as a listing?
 *
 * Checks the primary `wamid` and the `group_wamids` array, so any message from a
 * merged photo burst counts as already processed — not just the first one.
 *
 * Used as a cheap pre-flight check so a redelivery never reaches the model. The
 * unique index on `wamid` is the actual guarantee; this is the cost saver.
 *
 * @param {string} wamid
 * @returns {{id: number, created_at: string}|undefined} The existing row, if any.
 */
function findByWamid(wamid) {
  if (!wamid) return undefined;
  const id = String(wamid);

  const direct = db.prepare('SELECT id, created_at FROM listings WHERE wamid = ?').get(id);
  if (direct) return direct;

  // json_each errors on a non-JSON value, so screen out rows without a group.
  return db
    .prepare(
      `SELECT l.id, l.created_at
       FROM listings l, json_each(l.group_wamids)
       WHERE l.group_wamids IS NOT NULL AND json_each.value = ?
       LIMIT 1`,
    )
    .get(id);
}

// ---------------------------------------------------------------------------
// Multi-turn confirmation
//
// A listing is extracted and saved as 'pending_confirmation' immediately, then
// waits for the agent to reply. 'OK'/'Oui' publishes it as-is; anything else is
// treated as a correction and merged into the same row, so a back-and-forth
// never produces more than one row per listing.
// ---------------------------------------------------------------------------

/**
 * The most recent listing from this sender that is still awaiting 'OK'.
 *
 * @param {string} waId
 * @returns {Object|undefined}
 */
function findLatestPendingListing(waId) {
  if (!waId) return undefined;
  return parseRow(
    db
      .prepare(
        `SELECT * FROM listings
         WHERE wa_id = ? AND status = 'pending_confirmation'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(String(waId)),
  );
}

/**
 * Mark a listing published. Idempotent — publishing an already-published
 * listing just leaves it published.
 *
 * Also fires the Supabase Postgres sync (services/postgres.js) so the
 * listing reaches the website's admin approval queue. That sync is
 * fire-and-forget — awaited here only long enough to kick off, never
 * blocking the caller — so a Supabase outage can never delay the WhatsApp
 * confirmation the agent is waiting on. Required lazily so a test that never
 * publishes anything never even loads pg.
 *
 * @param {number} id
 * @returns {boolean} Whether a row was found and updated.
 */
function publishListing(id) {
  const info = db.prepare(`UPDATE listings SET status = 'published' WHERE id = ?`).run(id);
  const published = info.changes > 0;

  if (published) {
    const row = getListing(id);
    require('./postgres')
      .syncListingToPostgres(row)
      .then((remotePropertyId) => {
        if (remotePropertyId) {
          db.prepare('UPDATE listings SET remote_property_id = ? WHERE id = ?').run(remotePropertyId, id);
        }
      })
      .catch((err) => {
        console.error(`[postgres] sync failed for listing #${id}: ${err.message}`);
      });
  }

  return published;
}

/** Listing fields a correction message may overwrite. Never `id`/`wa_id`/`status`. */
const CORRECTABLE_FIELDS = [
  'intent', 'transaction_type', 'property_type', 'parcelle_subtype', 'commune', 'quartier',
  'price', 'currency', 'price_period', 'deposit_months', 'bedrooms', 'bathrooms',
  'surface_area_sqm', 'units_count', 'furnished', 'amenities', 'reference',
  'summary_fr', 'missing_fields',
];

const CORRECTABLE_COERCERS = {
  price: toNumber,
  bedrooms: toInteger,
  bathrooms: toInteger,
  surface_area_sqm: toNumber,
  units_count: toInteger,
  deposit_months: toInteger,
  furnished: toSqliteBool,
  amenities: toJsonText,
  missing_fields: toJsonText,
};

/**
 * Merge a follow-up message into an already-pending listing instead of
 * inserting a new row. Only fields the correction actually mentions are
 * overwritten — a message that only says "4 chambres" must not null out the
 * commune, price, etc. already on file.
 *
 * @param {number} id                Existing listing id (must be pending).
 * @param {Object} extractedData     `extracted_data` from a fresh parseMessage() call
 *                                    on the correction text.
 * @param {string} [rawText]         The correction message itself, appended to raw_text.
 * @param {string[]} [extraWamids]   Wamid(s) of the correction message, folded into
 *                                    group_wamids so a redelivery is recognised.
 * @param {string[]} [newPhotos]     Web paths of any newly downloaded photos —
 *                                    appended to the existing set, never replacing it.
 * @returns {Object} The updated, parsed row.
 */
function applyListingCorrection(id, extractedData, rawText, extraWamids = [], newPhotos = []) {
  const existing = getListing(id);
  if (!existing) {
    throw new Error(`applyListingCorrection: listing #${id} not found`);
  }

  const sets = [];
  const params = { id };

  for (const field of CORRECTABLE_FIELDS) {
    const value = extractedData?.[field];
    if (value === undefined || value === null || value === '') continue;
    const coerce = CORRECTABLE_COERCERS[field] || toNullable;
    sets.push(`${field} = @${field}`);
    params[field] = coerce(value);
  }

  if (rawText) {
    sets.push('raw_text = @raw_text');
    params.raw_text = [existing.raw_text, rawText].filter(Boolean).join('\n');
  }

  const mergedGroupWamids = Array.from(
    new Set([...(existing.group_wamids || []), ...extraWamids.filter(Boolean)]),
  );
  if (mergedGroupWamids.length) {
    sets.push('group_wamids = @group_wamids');
    params.group_wamids = toJsonText(mergedGroupWamids);
  }

  const mergedPhotos = [...(existing.photos || []), ...newPhotos.filter(Boolean)];
  if (mergedPhotos.length) {
    sets.push('photos = @photos');
    params.photos = toJsonText(mergedPhotos);
  }

  if (extractedData) {
    sets.push('parsed_json = @parsed_json');
    params.parsed_json = toJsonText({ ...(existing.parsed_json || {}), ...extractedData });
  }

  if (sets.length) {
    db.prepare(`UPDATE listings SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  return getListing(id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Best-effort JSON decode — returns the fallback rather than throwing. */
function fromJsonText(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Turn a raw row back into the shape the rest of the app uses: JSON columns
 * decoded, `furnished` back to a real boolean.
 */
function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    furnished: row.furnished === null ? null : Boolean(row.furnished),
    amenities: fromJsonText(row.amenities, []),
    missing_fields: fromJsonText(row.missing_fields, []),
    photos: fromJsonText(row.photos, []),
    group_wamids: fromJsonText(row.group_wamids, []),
    parsed_json: fromJsonText(row.parsed_json, null),
  };
}

/**
 * Most recent listings first — for quick inspection and the future admin view.
 *
 * @param {number} [limit=20]
 * @param {string} [waId] Restrict to one agent.
 */
function getRecentListings(limit = 20, waId) {
  const rows = waId
    ? db
        .prepare('SELECT * FROM listings WHERE wa_id = ? ORDER BY id DESC LIMIT ?')
        .all(String(waId), limit)
    : db.prepare('SELECT * FROM listings ORDER BY id DESC LIMIT ?').all(limit);

  return rows.map(parseRow);
}

function getListing(id) {
  return parseRow(db.prepare('SELECT * FROM listings WHERE id = ?').get(id));
}

/**
 * Reverse lookup for the admin moderation dashboard (web/): given a
 * Supabase `properties.id`, find the original submitter's wa_id. The link
 * only exists this direction — `listings.remote_property_id` is set once a
 * row syncs to Postgres (see services/postgres.js's syncListingToPostgres),
 * but `properties` itself carries no wa_id/phone column at all.
 */
function getListingByRemotePropertyId(remotePropertyId) {
  return parseRow(
    db.prepare('SELECT * FROM listings WHERE remote_property_id = ? ORDER BY id DESC LIMIT 1').get(remotePropertyId),
  );
}

const LISTINGS_LIMIT_DEFAULT = 50;
const LISTINGS_LIMIT_MAX = 100;

/** Repeated query params arrive as arrays — keep the last usable value. */
function firstScalar(value) {
  if (Array.isArray(value)) return firstScalar(value[value.length - 1]);
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

/**
 * Query listings with optional filters, newest first, with pagination.
 *
 * Filters are composed as parameterised fragments — never string-interpolated —
 * so a caller can hand user input straight through from a query string.
 *
 * A sloppy limit/offset falls back to the default rather than erroring, so the
 * endpoint stays usable with a hand-typed query string.
 *
 * @param {Object} [options]
 * @param {number} [options.limit=50]         Clamped to 1..100.
 * @param {number} [options.offset=0]         Clamped to >= 0.
 * @param {string} [options.commune]          Case-insensitive exact match.
 * @param {string} [options.transaction_type] 'location' | 'vente'.
 * @returns {{total: number, limit: number, offset: number, count: number, data: Object[]}}
 *          `total` counts every row matching the filters; `count`/`data` cover
 *          only the requested page.
 */
function getListings({ limit, offset, commune, transaction_type: transactionType } = {}) {
  const where = [];

  // Kept separate from limit/offset: better-sqlite3 rejects named parameters a
  // statement doesn't reference, and the COUNT query has no LIMIT clause.
  const filterParams = {};

  const communeFilter = firstScalar(commune);
  if (communeFilter !== undefined && String(communeFilter).trim() !== '') {
    // NOCASE so "gombe" matches the stored "Gombe". Note SQLite's NOCASE folds
    // ASCII only — it will not match "ndjili" against "Ndjili" if the stored
    // value carries accents.
    where.push('commune = @commune COLLATE NOCASE');
    filterParams.commune = String(communeFilter).trim();
  }

  const transactionFilter = firstScalar(transactionType);
  if (transactionFilter !== undefined && String(transactionFilter).trim() !== '') {
    where.push('transaction_type = @transaction_type COLLATE NOCASE');
    filterParams.transaction_type = String(transactionFilter).trim();
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const parsedLimit = Number.parseInt(firstScalar(limit), 10);
  const resolvedLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), LISTINGS_LIMIT_MAX)
    : LISTINGS_LIMIT_DEFAULT;

  const parsedOffset = Number.parseInt(firstScalar(offset), 10);
  const resolvedOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  // Total across the whole filtered set, independent of the page window — this
  // is what lets a client tell "50 results" from "50 of 300".
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM listings ${whereClause}`)
    .get(filterParams);

  // ORDER BY id DESC is a unique, stable sort, so pages cannot repeat or skip a
  // row the way an ordering on a non-unique column (created_at) would.
  const data = db
    .prepare(
      `SELECT * FROM listings
       ${whereClause}
       ORDER BY id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...filterParams, limit: resolvedLimit, offset: resolvedOffset })
    .map(parseRow);

  return {
    total,
    limit: resolvedLimit,
    offset: resolvedOffset,
    count: data.length,
    data,
  };
}

function countListings() {
  return db.prepare('SELECT COUNT(*) AS n FROM listings').get().n;
}

// ---------------------------------------------------------------------------
// Conversations / Messages / Leads / Viewing requests
//
// The customer-search side of the WhatsApp pipeline (product spec §6/§18),
// separate from the agent-listing-intake `listings` table above. Brand new
// tables, so — unlike `listings` — there is no ALTER TABLE migration path to
// maintain, just CREATE TABLE IF NOT EXISTS.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_id                    TEXT NOT NULL,
    state                    TEXT NOT NULL DEFAULT 'NEW',
    transaction_type         TEXT,
    property_type            TEXT,
    parcelle_subtype         TEXT,
    commune                  TEXT,
    quartier                 TEXT,
    price_min                REAL,
    price_max                REAL,
    bedrooms                 INTEGER,
    bathrooms                INTEGER,
    -- JSON array of Supabase properties.id shown in the most recent search —
    -- lets "combien coûte le premier ?" / "moins cher" resolve without the
    -- customer repeating a reference number.
    last_shown_property_ids  TEXT,
    selected_property_id     INTEGER,
    -- 1 = the AI replies automatically; 0 = a human agent has taken over
    -- (§17 human handoff) and the AI must stay silent until reactivated.
    ai_active                INTEGER NOT NULL DEFAULT 1,
    assigned_agent           TEXT,
    -- Internal admin notes (§19) — never sent to the customer, purely for
    -- the human agent's own record ("called, no answer", "wants a discount").
    notes                    TEXT,
    created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_wa_id ON conversations (wa_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_state  ON conversations (state);
`);

/**
 * Idempotent migration for `conversations`, same reasoning as `listings`'
 * EXTENDED_COLUMNS/migrate() above: `CREATE TABLE IF NOT EXISTS` only
 * applies to a brand-new file — an already-existing database (a long-running
 * dev server, or any deployed instance predating a later column) needs its
 * new nullable columns added explicitly. Caught by real local QA: the
 * `notes` column above didn't exist yet in an already-running dev server's
 * `lukka_place.db`, which had created the table before that column was added
 * to the CREATE statement.
 */
const CONVERSATIONS_EXTENDED_COLUMNS = [
  ['notes', 'TEXT'],
];

function migrateConversations() {
  const existing = new Set(
    db.prepare('PRAGMA table_info(conversations)').all().map((c) => c.name),
  );
  const missing = CONVERSATIONS_EXTENDED_COLUMNS.filter(([name]) => !existing.has(name));
  if (missing.length === 0) return [];

  db.transaction(() => {
    for (const [name, type] of missing) {
      db.exec(`ALTER TABLE conversations ADD COLUMN ${name} ${type}`);
    }
  })();

  const added = missing.map(([name]) => name);
  console.log(`[db] conversations schema migrated — added column(s): ${added.join(', ')}`);
  return added;
}

migrateConversations();

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id  INTEGER NOT NULL REFERENCES conversations (id),
    direction        TEXT NOT NULL, -- 'inbound' | 'outbound'
    wamid            TEXT,
    text             TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);

  CREATE TABLE IF NOT EXISTS leads (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id       INTEGER REFERENCES conversations (id),
    wa_id                 TEXT NOT NULL,
    name                  TEXT,
    source                TEXT NOT NULL DEFAULT 'whatsapp',
    property_id           INTEGER, -- Supabase properties.id, nullable (a lead can predate a specific property)
    transaction_type      TEXT,
    commune               TEXT,
    quartier              TEXT,
    price_min             REAL,
    price_max             REAL,
    bedrooms              INTEGER,
    requirements_summary  TEXT,
    status                TEXT NOT NULL DEFAULT 'NEW',
    assigned_agent        TEXT,
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_interaction_at   TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_leads_wa_id  ON leads (wa_id);
  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

  CREATE TABLE IF NOT EXISTS viewing_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL REFERENCES leads (id),
    property_id     INTEGER,
    -- Free text, not a strict timestamp: "demain matin", "ce week-end" are
    -- real customer answers that shouldn't be forced into a structured slot
    -- the conversation never actually collected.
    requested_time  TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_viewing_requests_lead_id ON viewing_requests (lead_id);
`);

/** Fields a requirements patch may set — mirrors CORRECTABLE_FIELDS's "only overwrite what's mentioned" rule. */
const CONVERSATION_REQUIREMENT_FIELDS = [
  'transaction_type', 'property_type', 'parcelle_subtype', 'commune', 'quartier',
  'price_min', 'price_max', 'bedrooms', 'bathrooms',
];

function parseConversationRow(row) {
  if (!row) return row;
  return {
    ...row,
    ai_active: Boolean(row.ai_active),
    last_shown_property_ids: fromJsonText(row.last_shown_property_ids, []),
  };
}

/**
 * Start a new conversation for a WhatsApp sender. Always creates a fresh
 * row — callers looking for an existing in-progress conversation should use
 * `getActiveConversation` first (see routes/webhook.js's future customer
 * message path).
 *
 * @param {string} waId
 * @returns {Object} The new conversation row.
 */
function createConversation(waId) {
  if (!waId) throw new Error('createConversation requires waId');
  const info = db
    .prepare(`INSERT INTO conversations (wa_id, state) VALUES (?, 'NEW')`)
    .run(String(waId));
  return getConversation(Number(info.lastInsertRowid));
}

function getConversation(id) {
  return parseConversationRow(db.prepare('SELECT * FROM conversations WHERE id = ?').get(id));
}

/**
 * The most recent conversation for this sender that isn't CLOSED — the one
 * an inbound customer message should continue, rather than starting a new
 * thread with no memory of what was already established (product spec §45).
 *
 * @param {string} waId
 * @returns {Object|undefined}
 */
function getActiveConversation(waId) {
  if (!waId) return undefined;
  return parseConversationRow(
    db
      .prepare(
        `SELECT * FROM conversations
         WHERE wa_id = ? AND state != 'CLOSED'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(String(waId)),
  );
}

/**
 * Move a conversation to a new state. Validated against
 * services/conversationState.js's transition table — an invalid transition
 * throws rather than silently corrupting the state machine.
 *
 * @param {number} id
 * @param {string} newState
 * @returns {Object} The updated conversation row.
 */
function updateConversationState(id, newState) {
  const { assertTransition } = require('./conversationState');
  const current = getConversation(id);
  if (!current) throw new Error(`updateConversationState: conversation #${id} not found`);

  assertTransition(current.state, newState);

  db.prepare(`UPDATE conversations SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(newState, id);
  return getConversation(id);
}

/**
 * Merge newly-extracted requirement fields into a conversation — only
 * fields actually present in `patch` are overwritten, so "2 chambres"
 * alone never nulls out a commune already on file (same rule as
 * applyListingCorrection above, product spec §9 "do not repeatedly ask for
 * information already provided").
 *
 * @param {number} id
 * @param {Object} patch Any of CONVERSATION_REQUIREMENT_FIELDS.
 * @returns {Object} The updated conversation row.
 */
function updateConversationRequirements(id, patch = {}) {
  const sets = [];
  const params = { id };

  for (const field of CONVERSATION_REQUIREMENT_FIELDS) {
    const value = patch[field];
    if (value === undefined || value === null || value === '') continue;
    sets.push(`${field} = @${field}`);
    params[field] = value;
  }

  if (sets.length === 0) return getConversation(id);

  sets.push('updated_at = CURRENT_TIMESTAMP');
  db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getConversation(id);
}

/** Record which properties (Supabase ids) were last shown, so a follow-up like "le premier" resolves. */
function setLastShownProperties(id, propertyIds) {
  db.prepare(`UPDATE conversations SET last_shown_property_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(toJsonText(propertyIds || []), id);
  return getConversation(id);
}

function setSelectedProperty(id, propertyId) {
  db.prepare(`UPDATE conversations SET selected_property_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(toNullable(propertyId), id);
  return getConversation(id);
}

/** Toggle AI auto-reply for a conversation — false while a human agent has taken over (§17). */
function setConversationAiActive(id, aiActive) {
  db.prepare(`UPDATE conversations SET ai_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(aiActive ? 1 : 0, id);
  return getConversation(id);
}

function assignConversationAgent(id, agentName) {
  db.prepare(`UPDATE conversations SET assigned_agent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(toNullable(agentName), id);
  return getConversation(id);
}

/** Internal admin notes (§19) — never sent to the customer. */
function updateConversationNotes(id, notes) {
  db.prepare(`UPDATE conversations SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(toNullable(notes), id);
  return getConversation(id);
}

const CONVERSATIONS_LIST_LIMIT_DEFAULT = 50;
const CONVERSATIONS_LIST_LIMIT_MAX = 100;

/**
 * Paginated conversation list for the admin dashboard, most recently
 * updated first, each row including a preview of its latest message so the
 * list view doesn't need a separate query per row.
 *
 * @param {Object} [options]
 * @param {string} [options.state] Filter to one conversationState.js state.
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @returns {{total: number, limit: number, offset: number, count: number, data: Object[]}}
 */
function listConversations({ state, limit, offset } = {}) {
  const where = [];
  const params = {};

  if (state) {
    where.push('state = @state');
    params.state = state;
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const parsedLimit = Number.parseInt(limit, 10);
  const resolvedLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), CONVERSATIONS_LIST_LIMIT_MAX)
    : CONVERSATIONS_LIST_LIMIT_DEFAULT;
  const parsedOffset = Number.parseInt(offset, 10);
  const resolvedOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM conversations ${whereClause}`).get(params);

  const rows = db
    .prepare(
      `SELECT c.*,
         (SELECT m.text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
         (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_direction
       FROM conversations c
       ${whereClause}
       ORDER BY c.updated_at DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: resolvedLimit, offset: resolvedOffset });

  return {
    total,
    limit: resolvedLimit,
    offset: resolvedOffset,
    count: rows.length,
    data: rows.map(parseConversationRow),
  };
}

/**
 * @param {number} conversationId
 * @param {'inbound'|'outbound'} direction
 * @param {Object} [options]
 * @param {string} [options.wamid]
 * @param {string} [options.text]
 * @returns {Object} The stored message row.
 */
function recordMessage(conversationId, direction, { wamid, text } = {}) {
  if (!conversationId) throw new Error('recordMessage requires conversationId');
  if (direction !== 'inbound' && direction !== 'outbound') {
    throw new Error(`recordMessage: direction must be 'inbound' or 'outbound', got '${direction}'`);
  }
  const info = db
    .prepare(`INSERT INTO messages (conversation_id, direction, wamid, text) VALUES (?, ?, ?, ?)`)
    .run(conversationId, direction, toNullable(wamid), toNullable(text));
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
}

/** Full transcript for a conversation, oldest first — for admin dashboard / agent handoff context (§48). */
function getMessages(conversationId, limit = 200) {
  return db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?')
    .all(conversationId, limit);
}

/**
 * The most recent `limit` messages, still returned oldest-first (chronological)
 * so they drop straight into a chat-completions `messages` array — unlike
 * `getMessages` above (which is "oldest N", right for a short admin
 * transcript view but wrong for a bounded recent-context window on a long
 * conversation). Used by services/buyerConversation.js.
 */
function getRecentMessages(conversationId, limit = 10) {
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
    .all(conversationId, limit);
  return rows.reverse();
}

const LEAD_FIELDS = [
  'conversation_id', 'wa_id', 'name', 'source', 'property_id', 'transaction_type',
  'commune', 'quartier', 'price_min', 'price_max', 'bedrooms', 'requirements_summary',
  'status', 'assigned_agent',
];

/**
 * Create a lead — every serious enquiry becomes one (product spec §18).
 *
 * @param {Object} data Subset of LEAD_FIELDS; `wa_id` is required.
 * @returns {Object} The new lead row.
 */
function createLead(data = {}) {
  if (!data.wa_id) throw new Error('createLead requires wa_id');

  const fields = LEAD_FIELDS.filter((f) => data[f] !== undefined);
  const info = db
    .prepare(
      `INSERT INTO leads (${fields.join(', ')}, status, last_interaction_at)
       VALUES (${fields.map((f) => `@${f}`).join(', ')}, @status, CURRENT_TIMESTAMP)`,
    )
    .run({ ...Object.fromEntries(fields.map((f) => [f, data[f]])), status: data.status || 'NEW' });

  return getLead(Number(info.lastInsertRowid));
}

function getLead(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

/** Most recent lead tied to a conversation, or undefined — lets a tool executor
 *  (services/openai.js's buyer assistant) reuse an existing lead instead of
 *  creating a duplicate one per tool call within the same conversation. */
function getLeadByConversationId(conversationId) {
  return db
    .prepare('SELECT * FROM leads WHERE conversation_id = ? ORDER BY id DESC LIMIT 1')
    .get(conversationId);
}

const LEAD_STATUSES = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING_REQUESTED', 'VIEWING_COMPLETED', 'CONVERTED', 'LOST',
];

function updateLeadStatus(id, status) {
  if (!LEAD_STATUSES.includes(status)) {
    throw new Error(`updateLeadStatus: unknown status '${status}' (expected one of ${LEAD_STATUSES.join(', ')})`);
  }
  db.prepare(
    `UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP, last_interaction_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(status, id);
  return getLead(id);
}

function getLeadsByStatus(status, limit = 50) {
  return status
    ? db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY id DESC LIMIT ?').all(status, limit)
    : db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT ?').all(limit);
}

/** Every lead ever tied to a conversation, most recent first — full enquiry history for the admin conversation detail view (§19), unlike getLeadByConversationId's single most-recent row. */
function getLeadsByConversation(conversationId) {
  return db.prepare('SELECT * FROM leads WHERE conversation_id = ? ORDER BY id DESC').all(conversationId);
}

const LEADS_LIST_LIMIT_DEFAULT = 50;
const LEADS_LIST_LIMIT_MAX = 100;

/**
 * Paginated lead list for the admin dashboard.
 *
 * @param {Object} [options]
 * @param {string} [options.status] Filter to one LEAD_STATUSES value.
 * @param {number[]} [options.propertyIds] Filter to leads on these property ids.
 * @param {string} [options.waId] Filter to one submitter's own leads (customer inquiry history).
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 * @returns {{total: number, limit: number, offset: number, count: number, data: Object[]}}
 */
function listLeads({ status, propertyIds, waId, limit, offset } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('status = @status');
    params.status = status;
  }
  // Customer inquiry history (web/) — a customer's own submitted leads,
  // looked up by their phone number (same digits-only wa_id shape a lead's
  // wa_id column already holds).
  if (waId) {
    where.push('wa_id = @waId');
    params.waId = waId;
  }
  // Agent dashboard's Lead Activity Stream (web/) — leads tied to any of
  // this agent's real property_ids (the remote Postgres properties.id, per
  // this column's own inline comment above). No IN-clause placeholder
  // helper exists in better-sqlite3 for a variable-length array, so this
  // builds one @p0, @p1, ... param per id explicitly.
  if (Array.isArray(propertyIds) && propertyIds.length > 0) {
    const placeholders = propertyIds.map((id, i) => {
      params[`p${i}`] = id;
      return `@p${i}`;
    });
    where.push(`property_id IN (${placeholders.join(', ')})`);
  }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const parsedLimit = Number.parseInt(limit, 10);
  const resolvedLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), LEADS_LIST_LIMIT_MAX)
    : LEADS_LIST_LIMIT_DEFAULT;
  const parsedOffset = Number.parseInt(offset, 10);
  const resolvedOffset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM leads ${whereClause}`).get(params);
  const data = db
    .prepare(`SELECT * FROM leads ${whereClause} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: resolvedLimit, offset: resolvedOffset });

  return { total, limit: resolvedLimit, offset: resolvedOffset, count: data.length, data };
}

/**
 * @param {Object} data
 * @param {number} data.leadId
 * @param {number} [data.propertyId]
 * @param {string} [data.requestedTime] Free text — see the column comment above.
 * @returns {Object} The new viewing_requests row.
 */
function createViewingRequest({ leadId, propertyId, requestedTime } = {}) {
  if (!leadId) throw new Error('createViewingRequest requires leadId');
  const info = db
    .prepare(`INSERT INTO viewing_requests (lead_id, property_id, requested_time) VALUES (?, ?, ?)`)
    .run(leadId, toNullable(propertyId), toNullable(requestedTime));
  return db.prepare('SELECT * FROM viewing_requests WHERE id = ?').get(Number(info.lastInsertRowid));
}

/** Flush WAL and release the file handle on shutdown. */
function close() {
  db.close();
}

module.exports = {
  db,
  saveListing,
  insertListing,
  findByWamid,
  findLatestPendingListing,
  publishListing,
  applyListingCorrection,
  getListings,
  getRecentListings,
  getListing,
  getListingByRemotePropertyId,
  countListings,
  parseRow,
  migrate,
  migrateConversations,
  CONVERSATIONS_EXTENDED_COLUMNS,
  seedLocations,
  close,
  DB_PATH,
  BASE_COLUMNS,
  EXTENDED_COLUMNS,
  LISTINGS_LIMIT_DEFAULT,
  LISTINGS_LIMIT_MAX,

  // Conversations / messages / leads / viewing requests
  createConversation,
  getConversation,
  getActiveConversation,
  updateConversationState,
  updateConversationRequirements,
  setLastShownProperties,
  setSelectedProperty,
  setConversationAiActive,
  assignConversationAgent,
  updateConversationNotes,
  listConversations,
  recordMessage,
  getMessages,
  getRecentMessages,
  createLead,
  getLead,
  getLeadByConversationId,
  getLeadsByConversation,
  updateLeadStatus,
  getLeadsByStatus,
  listLeads,
  createViewingRequest,
  LEAD_STATUSES,
  CONVERSATION_REQUIREMENT_FIELDS,
};
