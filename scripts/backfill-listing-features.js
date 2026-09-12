#!/usr/bin/env node
/**
 * scripts/backfill-listing-features.js
 *
 * Fills `properties.features` for listings that predate the extraction
 * emitting it, by re-running THE SAME extraction over each listing's stored
 * original WhatsApp message (`listings.raw_text` in SQLite).
 *
 * WHY THIS EXISTS SEPARATELY FROM scripts/migrate-listing-features.js
 * That script owns the schema (ADD COLUMN) and a regex line-filter over the
 * raw text. The filter is right for a genuinely list-formatted message and
 * wrong for everything else: measured on all 33 published listings
 * (2026-09-12) it produced usable lines for 23 of them, of which roughly a
 * quarter were advert framing rather than features — "2 APPARTEMENTS SUR
 * MONT DES ARTS HUILERIE", "Commune de Kinshasa", agency sign-offs. Each
 * round of filtering removed one category and revealed another, which is
 * what telling a feature from a sales pitch actually costs: understanding
 * the sentence.
 *
 * `parseMessage` already understands it. Its POINTS FORTS rules
 * (services/openai.js) are the same rules that govern every NEW listing, so
 * running them over old rows makes the whole catalogue consistent by
 * construction rather than by two implementations agreeing. That is the
 * entire argument for spending an API call per row, and it is why this
 * deliberately does NOT define its own narrower features-only prompt — a
 * second definition of "a feature" would drift from the one customers see on
 * new listings within a month.
 *
 * WHAT IT CANNOT RECOVER
 * Text only. The original intake often ran with photos attached and the
 * vision pass could see things the caption never said ("piscine", a visible
 * storey). Those are genuinely lost here; re-downloading and re-sending the
 * images would be a different, much more expensive job. A listing whose
 * message says nothing usable ends up with no features and falls back to the
 * AMENITY_KEYWORDS pass, exactly as it does today.
 *
 * SAFETY
 *   - Only ever fills a blank. A row that already has features — from a real
 *     sync, or from an earlier run of this — is never overwritten, so this is
 *     safe to re-run and safe to interrupt.
 *   - Writes BOTH SQLite and Postgres. This is not belt-and-braces: the
 *     engine's syncListingToPostgres builds `features` from the SQLite row,
 *     so writing only Postgres would mean the very next re-sync of that
 *     listing (an agent replying "OK" twice, a correction, a
 *     scripts/resync-published-listings.js run) quietly nulling it again.
 *   - One model failure is counted and skipped, never fatal.
 *
 * Usage:
 *   node scripts/backfill-listing-features.js --dry-run          # calls the model, writes nothing
 *   node scripts/backfill-listing-features.js --dry-run --limit 3
 *   node scripts/backfill-listing-features.js --limit 5          # write the first 5
 *   node scripts/backfill-listing-features.js                    # write them all
 *
 * --dry-run still spends the API calls. That is the point: the output is the
 * thing you are reviewing before letting it touch the public site.
 */

// services/openai.js and services/postgres.js read their config straight off
// process.env with no dotenv call of their own (index.js normally does it).
require('dotenv').config();

const dbService = require('../services/db');
const postgresService = require('../services/postgres');
const openaiService = require('../services/openai');

const MIN_FEATURE_CHARS = 3;
const MAX_FEATURE_CHARS = 80;
const MAX_FEATURES = 10;
const MIN_FEATURES = 2;

/**
 * A phone number in any of the shapes agents write. The ONE regex kept from
 * the heuristic script, and kept for a reason that is not stylistic: the dual
 * contact policy (CLAUDE.md, Lead Routing Rules) puts an agent's number on
 * the listing page through EnquiryCard deliberately, and a number arriving
 * instead as an anonymous "key feature" is the single failure here with a
 * real-world cost. The prompt already forbids it; this is the net under it.
 */
const PHONE = /\+?\d[\d\s.-]{7,}/;

/**
 * Shape and sanity only — NOT a semantic filter.
 *
 * Deciding whether a line is a feature is the model's job; re-litigating it
 * here with patterns is precisely the maintenance this script exists to
 * avoid. What is checked is what a regex can actually know: that the value is
 * a list of non-empty strings of a readable length, that no entry carries a
 * phone number, and that there are enough of them to be a list at all.
 *
 * @param {unknown} value `extracted_data.features` as the model returned it.
 * @returns {{features: string[], rejected: string[]}}
 */
function sanitiseFeatures(value) {
  const rejected = [];
  if (!Array.isArray(value)) return { features: [], rejected };

  const seen = new Set();
  const features = [];

  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const line = entry.trim().replace(/[.;,\s]+$/, '');

    if (line.length < MIN_FEATURE_CHARS || line.length > MAX_FEATURE_CHARS) {
      if (line) rejected.push(line);
      continue;
    }
    if (PHONE.test(line)) {
      rejected.push(line);
      continue;
    }

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    features.push(line);
    if (features.length >= MAX_FEATURES) break;
  }

  // One bullet is a sentence with a tick next to it, not a feature list.
  return { features: features.length >= MIN_FEATURES ? features : [], rejected };
}

/**
 * The live listings that still have no features, as `properties.id`s.
 *
 * Scoped by the same `status = 1 AND approve_status = 1` gate as every other
 * read against this table — a pending or retired listing is not part of the
 * public catalogue and is not worth an API call.
 */
async function propertiesNeedingFeatures(postgres) {
  const { rows } = await postgres.getPool().query(
    `SELECT id FROM properties
      WHERE status = 1 AND approve_status = 1
        AND (features IS NULL OR cardinality(features) = 0)
      ORDER BY id`,
  );
  return rows.map((r) => Number(r.id));
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false] Call the model, print, write nothing.
 * @param {number}  [options.limit]        Stop after this many rows.
 * @param {Object}  [options.db=dbService]
 * @param {Object}  [options.postgres=postgresService]
 * @param {Function} [options.parse]       Injectable for tests; defaults to the real parseMessage.
 */
async function runBackfill({
  dryRun = false,
  limit,
  db = dbService,
  postgres = postgresService,
  parse = openaiService.parseMessage,
} = {}) {
  const needing = await propertiesNeedingFeatures(postgres);
  const needingSet = new Set(needing);

  const localRows = db.db
    .prepare("SELECT * FROM listings WHERE status = 'published' AND remote_property_id IS NOT NULL")
    .all()
    .map(db.parseRow)
    .filter((row) => needingSet.has(Number(row.remote_property_id)));

  // A published property with no local row at all — synced before this engine
  // existed, or created through web/'s agent form, which writes Postgres
  // directly. There is no original message to re-read, so it is not a failure
  // and not something to invent around; it is reported and left alone.
  const withLocalText = new Set(localRows.map((r) => Number(r.remote_property_id)));
  const unreachable = needing.filter((id) => !withLocalText.has(id));

  const targets = limit ? localRows.slice(0, limit) : localRows;

  const result = {
    needing: needing.length,
    unreachable,
    attempted: 0,
    written: 0,
    empty: 0,
    failed: 0,
    changes: [],
  };

  const pool = postgres.getPool();

  for (const row of targets) {
    if (!row.raw_text || !String(row.raw_text).trim()) {
      result.empty += 1;
      continue;
    }

    result.attempted += 1;

    let extracted;
    try {
      // Text only, and no draft/history: this is a fresh read of one stored
      // message, not a turn in a conversation. `senderPhone` is passed
      // because the prompt uses it, not because anything is sent anywhere.
      ({ extracted_data: extracted } = await parse(row.raw_text, { senderPhone: row.wa_id }));
    } catch (err) {
      result.failed += 1;
      console.error(`[features] listing #${row.id} -> property #${row.remote_property_id}: ${err.message}`);
      continue;
    }

    const { features, rejected } = sanitiseFeatures(extracted?.features);

    if (rejected.length) {
      console.warn(
        `[features] listing #${row.id}: dropped ${rejected.length} unusable line(s): ${JSON.stringify(rejected)}`,
      );
    }

    if (!features.length) {
      result.empty += 1;
      console.log(`[features] listing #${row.id} -> property #${row.remote_property_id}: nothing usable, left NULL`);
      continue;
    }

    result.changes.push({ id: row.id, propertyId: Number(row.remote_property_id), features });

    if (dryRun) continue;

    try {
      // SQLite first. If the Postgres write then fails, the next ordinary
      // re-sync of this listing carries the features anyway — whereas the
      // reverse order can leave Postgres holding a value the engine will
      // overwrite with NULL the next time it syncs.
      db.db
        .prepare('UPDATE listings SET features = ? WHERE id = ?')
        .run(JSON.stringify(features), row.id);

      const { rowCount } = await pool.query(
        `UPDATE properties SET features = $1, updated_at = NOW()
          WHERE id = $2 AND (features IS NULL OR cardinality(features) = 0)`,
        [features, row.remote_property_id],
      );
      if (rowCount > 0) result.written += 1;
      else console.log(`[features] property #${row.remote_property_id} gained features elsewhere — left as found`);
    } catch (err) {
      result.failed += 1;
      console.error(`[features] writing listing #${row.id} failed: ${err.message}`);
    }
  }

  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((a) => a.startsWith('--limit'));
  const limit = limitArg
    ? Number.parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
    : undefined;

  if (!postgresService.isConfigured()) {
    console.error('[features] DB_HOST/DB_USER/DB_PASSWORD/DB_NAME are not all set — nothing to do.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('[features] OPENAI_API_KEY is not set — this backfill is a model pass, it cannot run without it.');
    process.exit(1);
  }

  console.log(
    `[features] model-based backfill${dryRun ? ' (dry run — the model IS called, nothing is written)' : ''}`
      + `${Number.isFinite(limit) ? `, limit ${limit}` : ''}`,
  );

  const result = await runBackfill({ dryRun, limit: Number.isFinite(limit) ? limit : undefined });

  for (const change of result.changes) {
    console.log(`\n  listing #${change.id} -> property #${change.propertyId}`);
    for (const feature of change.features) console.log(`    • ${feature}`);
  }

  console.log(
    `\n[features] ${result.needing} live listing(s) had no features. `
      + `${result.attempted} had a stored message to re-read; `
      + `${dryRun ? `${result.changes.length} would be written` : `${result.written} written`}, `
      + `${result.empty} produced nothing usable, ${result.failed} failed.`,
  );

  if (result.unreachable.length) {
    console.log(
      `[features] ${result.unreachable.length} live listing(s) have no original message on file `
        + `and cannot be backfilled at all (property ${result.unreachable.join(', ')}) — `
        + 'they keep falling back to the keyword pass, which is correct.',
    );
  }

  dbService.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[features] fatal:', err);
    process.exit(1);
  });
}

module.exports = { runBackfill, sanitiseFeatures, propertiesNeedingFeatures };
