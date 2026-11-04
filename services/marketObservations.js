'use strict';

/**
 * services/marketObservations.js — asking prices seen outside Lukka Place's
 * own public listings, for the price guide (/combien-coute) and the admin
 * commune comparison. migrations/20261104_market_observations.sql.
 *
 * WHY
 * The guide rested on ~175 live rentals of our own; most commune × bedroom
 * pairs had fewer than five and showed nothing. Kinshasa's market is mostly
 * posted elsewhere — WhatsApp groups, a handful of listing sites, Facebook.
 *
 * SOURCES (decided 2026-11-04, owner request; terms of use read that day)
 *   collected automatically, facts only, politely (marketSources/http.js):
 *   - whatsapp_group  our own group captures (services/groupRelay.js), from
 *                     authorised groups only — EXCLUDED_GROUP_JIDS below
 *                     (empty since Vitesse maximale 5/5 was authorised).
 *                     Owner decision: the intake store is never a source for
 *                     the storefront's LISTINGS; its prices may feed medians.
 *   - immo24          immo24.cd, public WordPress REST feed. robots.txt
 *                     empty, terms page has no terms.
 *   - imcongo         imcongo.com result lists (one page per type), robots
 *                     Crawl-delay 10. Its terms forbid reproducing or
 *                     redistributing content — we keep a price, a bedroom
 *                     count and a commune per advert, show none of it.
 *   - alain_realty    alain-realty.net, sitemap + property pages.
 *   - smartimmo       smartimmo-app.com, sitemap + each listing's schema.org
 *                     data. The id is a UUIDv7, i.e. carries its post date.
 *   - mediacongo      mediacongo.net property classifieds (added 2026-11-04,
 *                     owner request): list pages back to COLLECT_SINCE, the
 *                     advert page only for rentals / unclear titles. robots
 *                     Crawl-delay 10, no Disallow. Terms forbid reproducing
 *                     content without authorisation — same position as
 *                     IMCongo: facts into a median, nothing shown. Mostly
 *                     sales (~1 in 8 is a rental).
 *   entered by hand from /admin/market-data (web), never collected:
 *   - facebook        Meta's terms forbid automated collection.
 *   - zwandako        its terms forbid robots ("surveiller ou copier … à
 *                     l'aide d'un robot") without written permission. Its
 *                     public feed has ~8,000 adverts; ask them, don't take it.
 *   not used: keur-immo.com (bot challenge), theafricanvestor.com (estimates
 *   with no sources and contradicting each other — shown to admins as
 *   published estimates, web/lib/data/published-rent-estimates.json, never
 *   in a median).
 *
 * WHAT A ROW SAYS
 * One advert seen at one source. `posted_at` when the source dates it,
 * `first_seen_at` / `last_seen_at` when we saw it. Only adverts posted on or
 * after COLLECT_SINCE are collected when the source has a date; undated ones
 * (IMCongo) are adverts online the night we looked. Nothing is ever shown as
 * a listing, and no photo, description or phone number is stored.
 *
 * CLEANING (normaliseObservation) — a figure that cannot be trusted is kept
 * with `excluded_reason` rather than dropped, so the admin list can show what
 * was refused and why:
 *   - francs: no conversion here (`currency_cdf`); Kinshasa rents are quoted
 *     in dollars and a converted figure would carry a rate we did not choose.
 *   - a day / week price is a short stay (`short_stay`), never a monthly rent.
 *   - a rent outside 30–20,000 $ a month or a sale outside 1,000–20,000,000 $
 *     (`price_out_of_range`): SmartImmo carries "210 000 USD / mois" on a
 *     house the text calls a sale.
 *   - the commune is resolved through services/locations.js like every other
 *     place in this system; one that does not resolve stays NULL (not counted
 *     by commune, never guessed).
 */

const postgres = require('./postgres');
const locations = require('./locations');
const cities = require('./cities');
const { fold } = require('./marketSources/text');

const JOB_NAME = 'market-observations';
const COLLECT_SINCE = '2026-01-01T00:00:00Z';
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

const SOURCES = ['whatsapp_group', 'immo24', 'imcongo', 'alain_realty', 'smartimmo', 'mediacongo', 'facebook', 'zwandako', 'other'];
const COLLECTED_SOURCES = ['whatsapp_group', 'immo24', 'imcongo', 'alain_realty', 'smartimmo', 'mediacongo'];
const MANUAL_SOURCES = ['facebook', 'zwandako', 'other'];

/** Kinds the price guide counts. Everything else is stored but not in a rent median. */
const RESIDENTIAL_KINDS = ['appartement', 'maison', 'villa', 'studio', 'duplex', 'penthouse'];
const PROPERTY_KINDS = [...RESIDENTIAL_KINDS, 'chambre', 'terrain', 'bureau', 'commercial', 'immeuble', 'autre'];

/**
 * Groups whose captures never become market data. Empty since 2026-11-04:
 * "Vitesse maximale 5/5" (120363424833758385@g.us), excluded while we had no
 * authorisation to use its data, was re-added by the owner that day with the
 * group's authorisation. A group we may not use goes here, or in
 * MARKET_EXCLUDED_GROUP_JIDS (comma-separated, read at call time).
 */
const EXCLUDED_GROUP_JIDS = [];

function excludedGroupJids() {
  const extra = String(process.env.MARKET_EXCLUDED_GROUP_JIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...EXCLUDED_GROUP_JIDS, ...extra]);
}

const BOUNDS = {
  rent: { min: 30, max: 20000 },
  sale: { min: 1000, max: 20000000 },
};

/**
 * Free text ("Appartment", "Maison Unifamiliale", "APPARTEMENT 2 CHAMBRES",
 * "House", "Local commercial") → one of PROPERTY_KINDS, or null.
 *
 * Non-residential words win: "Appartement ou bureau" is not counted as a
 * home, which is the conservative reading.
 */
function kindFromText(text) {
  const t = fold(text);
  if (!t.trim()) return null;
  if (/\b(terrain|parcelle nue|plot|ground|concession|lot)\b/.test(t)) return 'terrain';
  if (/\b(immeuble|building|batiment)\b/.test(t)) return 'immeuble';
  if (/\b(bureau|bureaux|office|open space)\b/.test(t)) return 'bureau';
  if (/\b(local commercial|commercial|boutique|magasin|shop|entrepot|warehouse|salle de fete|hotel)\b/.test(t)) return 'commercial';
  if (/\bstudio\b/.test(t)) return 'studio';
  if (/\bduplex\b/.test(t)) return 'duplex';
  if (/\bpenthouse\b/.test(t)) return 'penthouse';
  if (/\bvilla\b/.test(t)) return 'villa';
  if (/\b(appartement|appartment|apartment|apartments|appart|flat|residence)\b/.test(t)) return 'appartement';
  if (/\b(maison|house|home|single family)\b/.test(t)) return 'maison';
  if (/\b(chambre|annexe)\b/.test(t)) return 'chambre';
  return null;
}

/**
 * The commune key for whatever place text a source gives ("Kinshasa -
 * Limete", "Gombe, Kinshasa, Democratic Republic of the Congo", "GB",
 * "Kinshasa Centre Ville"), or null. Tries each comma/dash piece as a commune,
 * then the whole text through inferCommune (quartiers and aliases: "GB" →
 * Ngaliema), unique answers only.
 */
function resolvePlace(...texts) {
  const pieces = [];
  for (const text of texts) {
    if (!text) continue;
    for (const piece of String(text).split(/[,|/]| - | – /)) {
      const p = piece.trim();
      if (p && !/^(kinshasa|rd ?congo|rdc|drc|democratic republic of the congo|republique democratique du congo|congo|cd)$/i.test(fold(p))) pieces.push(p);
    }
  }
  for (const piece of pieces) {
    const commune = locations.resolveCommune(piece);
    // resolveCommune fuzzy-matches; only accept a confident, whole-name hit.
    if (commune && fold(cities.communeLabel(commune)).replace(/[^a-z0-9]/g, '') === fold(piece).replace(/[^a-z0-9]/g, '')) return commune;
  }
  for (const piece of pieces) {
    const inferred = locations.inferCommune(piece, { allowFuzzy: false });
    if (inferred.status === 'unique') return inferred.commune;
  }
  return null;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const s = String(value).trim();
  // SQLite CURRENT_TIMESTAMP is UTC with no zone.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const clip = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * A collector's raw advert → a row for market_observations, with
 * `excluded_reason` set when the figure cannot be trusted. Pure.
 *
 * @param {{source: string, source_ref: string|number, source_url?: string, property_id?: number,
 *   posted_at?: string|Date, purpose: 'rent'|'sale'|null, property_kind?: string, kind_text?: string,
 *   beds?: number, furnished?: boolean|null, price?: number, currency?: string, price_period?: string,
 *   commune?: string, commune_key?: string, place_text?: string, quartier?: string, title?: string}} raw
 */
function normaliseObservation(raw) {
  if (!SOURCES.includes(raw.source)) throw new Error(`unknown market source '${raw.source}'`);
  const sourceRef = clip(raw.source_ref, 300);
  if (!sourceRef) throw new Error('source_ref is required');

  const purpose = raw.purpose === 'rent' || raw.purpose === 'sale' ? raw.purpose : null;
  const kind = PROPERTY_KINDS.includes(raw.property_kind) ? raw.property_kind : kindFromText(raw.kind_text || raw.property_kind || '');
  const bedsNumber = raw.beds === null || raw.beds === undefined || raw.beds === '' ? NaN : Number(raw.beds);
  let beds = Number.isInteger(bedsNumber) && bedsNumber >= 0 && bedsNumber <= 30 ? bedsNumber : null;
  // "0 chambres" on a house or a flat is a form left blank (SmartImmo), not a
  // home without a bedroom; only a studio or a room can truly have none.
  if (beds === 0 && !['studio', 'chambre'].includes(kind)) beds = null;
  const priceNumber = raw.price === null || raw.price === undefined || raw.price === '' ? NaN : Number(raw.price);
  const price = Number.isFinite(priceNumber) && priceNumber > 0 ? priceNumber : null;
  const currency = /^(cdf|fc|franc)/i.test(String(raw.currency || '')) ? 'CDF' : 'USD';

  let period = ['mois', 'an', 'total', 'jour', 'semaine'].includes(raw.price_period) ? raw.price_period : null;
  if (!period) period = purpose === 'sale' ? 'total' : 'mois';

  let commune = raw.commune_key && locations.LOCATIONS[raw.commune_key] ? raw.commune_key : null;
  if (!commune) commune = resolvePlace(raw.commune, raw.place_text, raw.quartier);
  const city = commune ? cities.cityOfCommune(commune) : null;

  let monthly = null;
  let priceUsd = null;
  let excluded = null;
  if (!purpose) excluded = 'no_purpose';
  else if (!price) excluded = 'no_price';
  else if (currency === 'CDF') excluded = 'currency_cdf';
  else {
    priceUsd = price;
    if (purpose === 'rent') {
      if (period === 'jour' || period === 'semaine') excluded = 'short_stay';
      else if (period === 'total') excluded = 'no_period';
      else monthly = period === 'an' ? Math.round((price / 12) * 100) / 100 : price;
      const check = monthly ?? null;
      if (!excluded && (check < BOUNDS.rent.min || check > BOUNDS.rent.max)) excluded = 'price_out_of_range';
    } else if (price < BOUNDS.sale.min || price > BOUNDS.sale.max) {
      excluded = 'price_out_of_range';
    }
  }

  return {
    source: raw.source,
    source_ref: sourceRef,
    source_url: clip(raw.source_url, 1000),
    property_id: Number.isInteger(Number(raw.property_id)) && Number(raw.property_id) > 0 ? Number(raw.property_id) : null,
    posted_at: toIso(raw.posted_at),
    purpose: purpose || 'rent',
    property_kind: kind,
    beds,
    furnished: typeof raw.furnished === 'boolean' ? raw.furnished : null,
    price,
    currency,
    price_period: period,
    monthly_usd: monthly,
    price_usd: priceUsd,
    city,
    commune,
    quartier: clip(raw.quartier, 120),
    title: clip(raw.title, 200),
    excluded_reason: excluded,
  };
}

const COLUMNS = [
  'source', 'source_ref', 'source_url', 'property_id', 'posted_at', 'purpose', 'property_kind', 'beds',
  'furnished', 'price', 'currency', 'price_period', 'monthly_usd', 'price_usd', 'city', 'commune',
  'quartier', 'title', 'excluded_reason',
];

/**
 * Insert or refresh. A row seen again keeps its first_seen_at, moves
 * last_seen_at, takes the source's current figures (an advert whose price
 * changed is the new asking price) — and keeps an exclusion a team member
 * made by hand ('manual:…').
 */
const UPSERT_SQL = `
  INSERT INTO market_observations (${COLUMNS.join(', ')}, first_seen_at, last_seen_at, updated_at)
  SELECT ${COLUMNS.map((c) => `r.${c}`).join(', ')}, NOW(), NOW(), NOW()
    FROM jsonb_to_recordset($1::jsonb) AS r(
      source text, source_ref text, source_url text, property_id bigint, posted_at timestamptz,
      purpose text, property_kind text, beds smallint, furnished boolean, price numeric, currency text,
      price_period text, monthly_usd numeric, price_usd numeric, city text, commune text, quartier text,
      title text, excluded_reason text)
  ON CONFLICT (source, source_ref) DO UPDATE SET
    source_url = EXCLUDED.source_url,
    property_id = COALESCE(EXCLUDED.property_id, market_observations.property_id),
    posted_at = COALESCE(market_observations.posted_at, EXCLUDED.posted_at),
    purpose = EXCLUDED.purpose,
    property_kind = EXCLUDED.property_kind,
    beds = EXCLUDED.beds,
    furnished = EXCLUDED.furnished,
    price = EXCLUDED.price,
    currency = EXCLUDED.currency,
    price_period = EXCLUDED.price_period,
    monthly_usd = EXCLUDED.monthly_usd,
    price_usd = EXCLUDED.price_usd,
    city = EXCLUDED.city,
    commune = COALESCE(EXCLUDED.commune, market_observations.commune),
    quartier = EXCLUDED.quartier,
    title = EXCLUDED.title,
    excluded_reason = CASE WHEN market_observations.excluded_reason LIKE 'manual:%'
                           THEN market_observations.excluded_reason ELSE EXCLUDED.excluded_reason END,
    last_seen_at = NOW(),
    updated_at = NOW()
  RETURNING (xmax = 0) AS inserted
`;

/** Marks adverts still listed at the source (seen in a sitemap) without re-reading them. */
const TOUCH_SQL = `
  UPDATE market_observations SET last_seen_at = NOW()
   WHERE source = $1 AND source_ref = ANY($2::text[])
`;

const KNOWN_REFS_SQL = 'SELECT source_ref FROM market_observations WHERE source = $1';

const RECORD_RUN_SQL = `
  INSERT INTO market_source_runs (source, last_run_at, last_ok_at, fetched, stored, excluded, last_error)
  VALUES ($1, NOW(), CASE WHEN $5::text IS NULL THEN NOW() END, $2, $3, $4, $5)
  ON CONFLICT (source) DO UPDATE SET
    last_run_at = NOW(),
    last_ok_at = CASE WHEN $5::text IS NULL THEN NOW() ELSE market_source_runs.last_ok_at END,
    fetched = $2, stored = $3, excluded = $4, last_error = $5
`;

async function storeObservations(rows, { pool = postgres.getPool() } = {}) {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((row) => Object.fromEntries(COLUMNS.map((c) => [c, row[c] ?? null])));
    // eslint-disable-next-line no-await-in-loop
    const { rows: result } = await pool.query(UPSERT_SQL, [JSON.stringify(chunk)]);
    for (const r of result) { if (r.inserted) inserted += 1; else updated += 1; }
  }
  return { inserted, updated };
}

async function knownRefs(source, { pool = postgres.getPool() } = {}) {
  const { rows } = await pool.query(KNOWN_REFS_SQL, [source]);
  return new Set(rows.map((r) => r.source_ref));
}

async function touchRefs(source, refs, { pool = postgres.getPool() } = {}) {
  if (!refs.length) return 0;
  const { rowCount } = await pool.query(TOUCH_SQL, [source, refs]);
  return rowCount;
}

function collectorFor(source) {
  // eslint-disable-next-line global-require
  const map = {
    whatsapp_group: () => require('./marketSources/whatsappGroup'),
    immo24: () => require('./marketSources/immo24'),
    imcongo: () => require('./marketSources/imcongo'),
    alain_realty: () => require('./marketSources/alainRealty'),
    smartimmo: () => require('./marketSources/smartimmo'),
    mediacongo: () => require('./marketSources/mediacongo'),
  };
  if (!map[source]) throw new Error(`no collector for '${source}'`);
  return map[source]();
}

/**
 * Collects the given sources one after another. Each source is isolated: one
 * site down never stops the others, and each outcome is written to
 * market_source_runs.
 *
 * @param {{sources?: string[], write?: boolean, maxDetailFetches?: number, log?: Function, pool?: object}} [options]
 */
async function runCollection({
  sources = COLLECTED_SOURCES,
  write = true,
  maxDetailFetches = Number.parseInt(process.env.MARKET_MAX_DETAIL_FETCHES, 10) || 600,
  log = (line) => console.log(`[market] ${line}`),
  pool = write ? postgres.getPool() : null,
} = {}) {
  const summary = {};
  for (const source of sources) {
    const started = Date.now();
    try {
      const collector = collectorFor(source);
      const refs = pool ? await knownRefs(source, { pool }) : new Set();
      // eslint-disable-next-line no-await-in-loop
      const result = await collector.collect({ since: COLLECT_SINCE, knownRefs: refs, maxDetailFetches, log });
      const rows = [];
      let rejected = 0;
      for (const raw of result.observations) {
        try { rows.push(normaliseObservation({ ...raw, source })); } catch (err) { rejected += 1; log(`${source}: skipped ${raw.source_ref}: ${err.message}`); }
      }
      const excluded = rows.filter((r) => r.excluded_reason).length;
      let stored = { inserted: 0, updated: 0 };
      let touched = 0;
      if (write && pool) {
        // eslint-disable-next-line no-await-in-loop
        stored = await storeObservations(rows, { pool });
        // eslint-disable-next-line no-await-in-loop
        touched = await touchRefs(source, result.stillListed || [], { pool });
        // eslint-disable-next-line no-await-in-loop
        await pool.query(RECORD_RUN_SQL, [source, rows.length + rejected, stored.inserted + stored.updated, excluded, null]);
      }
      summary[source] = { fetched: rows.length, excluded, rejected, ...stored, touched, requests: result.requests ?? null, seconds: Math.round((Date.now() - started) / 1000) };
      if (!write) summary[source].sample = rows.slice(0, 5);
      log(`${source}: ${JSON.stringify({ ...summary[source], sample: undefined })}`);
    } catch (err) {
      summary[source] = { error: err.message };
      log(`${source}: FAILED ${err.message}`);
      if (write && pool) {
        // eslint-disable-next-line no-await-in-loop
        await pool.query(RECORD_RUN_SQL, [source, null, null, null, err.message.slice(0, 500)]).catch(() => {});
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Scheduler job — nightly, in the background
// ---------------------------------------------------------------------------

const CONFIGURED_HOUR = Number.parseInt(process.env.MARKET_COLLECT_HOUR, 10);
const RUN_HOUR_KINSHASA = Number.isFinite(CONFIGURED_HOUR) ? CONFIGURED_HOUR : 2;

let running = null;

function collectionDue(now = new Date()) {
  if (process.env.MARKET_COLLECTION === 'off') return false;
  if (running) return false;
  if (!postgres.isConfigured()) return false;
  const local = new Date(now.getTime() + 60 * 60 * 1000);
  if (local.getUTCHours() !== RUN_HOUR_KINSHASA) return false;
  // eslint-disable-next-line global-require
  const last = require('./db').getLastJobRun(JOB_NAME);
  if (!last?.succeeded_at) return true;
  const at = Date.parse(`${String(last.succeeded_at).replace(' ', 'T')}Z`);
  return !Number.isFinite(at) || now.getTime() - at >= MIN_GAP_MS;
}

/**
 * Starts the collection and returns at once. A night's collection is a few
 * hundred spaced requests (tens of minutes); awaiting it would hold every
 * job behind it in that scheduler tick. The in-process `running` flag stops
 * a second run starting while one is going; a collection that fails as a
 * whole records a failed job run, which ops-health-alerts reports. A single
 * source failing is recorded on market_source_runs and shown on the admin page.
 */
function startCollectionInBackground() {
  if (running) return { started: false, reason: 'already-running' };
  running = runCollection()
    .then((summary) => {
      const failed = Object.entries(summary).filter(([, s]) => s.error).map(([name]) => name);
      console.log(`[scheduler] ${JOB_NAME} done${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
    })
    .catch((err) => {
      console.error(`[scheduler] ${JOB_NAME} failed: ${err.message}`);
      // eslint-disable-next-line global-require
      require('./db').recordJobRun(JOB_NAME, { ok: false, detail: err.message.slice(0, 500) });
    })
    .finally(() => { running = null; });
  return { started: true };
}

const marketObservationsJob = {
  name: JOB_NAME,
  shouldRun: collectionDue,
  run: async () => startCollectionInBackground(),
};

module.exports = {
  JOB_NAME,
  COLLECT_SINCE,
  SOURCES,
  COLLECTED_SOURCES,
  MANUAL_SOURCES,
  RESIDENTIAL_KINDS,
  PROPERTY_KINDS,
  EXCLUDED_GROUP_JIDS,
  BOUNDS,
  UPSERT_SQL,
  excludedGroupJids,
  kindFromText,
  resolvePlace,
  normaliseObservation,
  storeObservations,
  knownRefs,
  runCollection,
  collectionDue,
  marketObservationsJob,
};
