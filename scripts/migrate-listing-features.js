#!/usr/bin/env node
/**
 * scripts/migrate-listing-features.js
 *
 * Two jobs, in order, both idempotent:
 *
 *   1. ALTER TABLE properties ADD COLUMN IF NOT EXISTS features text[]
 *      — the storefront's "Caractéristiques principales" list
 *      (web/components/listings/PropertyDescription.js) and the column
 *      services/postgres.js's buildPropertyValues now writes on every sync.
 *
 *   2. Backfill it for listings that already exist, from the agent's OWN
 *      original WhatsApp message (`listings.raw_text` in SQLite), for every
 *      published local listing whose Postgres row still has no features.
 *
 * WHY raw_text AND NOT properties.description
 * The obvious backfill source is the public description, and it is the wrong
 * one twice over. Checked directly against production: 0 of the 48 currently
 * approved descriptions contain a single newline or bullet — they are all
 * one flowing sentence written for a reader ("Cet appartement situé au
 * premier niveau dans la commune de Bandalungwa est disponible à la
 * location."). Sentence-splitting that produces bullets that restate the
 * paragraph immediately below them, which makes the section look populated
 * while adding nothing. The agent's raw WhatsApp message is the opposite: it
 * is genuinely line-per-fact, because that is how agents type.
 *
 * It is also what makes the UI's caption true. A row with a real `features`
 * value is captioned "Points forts extraits du message de l'agent"
 * (listings.detail.featuresFromAgent); filling the column from prose we
 * rewrote ourselves would make that caption a lie. A listing this script
 * cannot backfill is LEFT NULL on purpose — the read side
 * (web/lib/descriptionParser.js) then falls back to the AMENITY_KEYWORDS
 * pass over the listing's text, which carries its own, weaker, honest
 * caption. Not backfilling is a real outcome here, not a failure.
 *
 * THE LINE FILTER IS DUPLICATED, DELIBERATELY
 * `featureLinesFromText` below is the same rule as
 * web/lib/descriptionParser.js's `parseFeatureLines`, restated because this
 * script is CommonJS and lives outside that app's module graph — the same
 * duplication web/scripts/geocode-listings.js already carries, with the same
 * warning: CHANGE ONE, CHANGE THE OTHER. It is covered on both sides
 * (scripts/verify-pipeline.js §22 here, tests/unit/description-parser.test.js
 * there) so a drift shows up as a failure rather than as two subtly
 * different feature lists.
 *
 * Usage:
 *   node scripts/migrate-listing-features.js             # alter + backfill
 *   node scripts/migrate-listing-features.js --dry-run   # report only, no writes
 *   node scripts/migrate-listing-features.js --schema-only
 */

// services/postgres.js reads DB_* straight off process.env with no dotenv
// call of its own (it is normally loaded by index.js, which does), so a
// script run on its own has to load the environment itself — same line
// scripts/resync-published-listings.js carries for the same reason.
require('dotenv').config();

const dbService = require('../services/db');
const postgresService = require('../services/postgres');

const MIN_LINE_CHARS = 3;
const MAX_LINE_CHARS = 80;
const MAX_LINES = 10;

/**
 * Lines that are real in the agent's message and wrong on a public page.
 *
 * Every entry here came out of a real `--dry-run` against production data,
 * not from imagining what an agent might type:
 *
 *   "☎️Pour Tout Contact Eugene ML+243…"   an agent's personal number. The
 *                                          dual contact policy routes that
 *                                          through EnquiryCard deliberately
 *                                          (CLAUDE.md, Lead Routing Rules);
 *                                          it must not leak into a bullet
 *                                          list on the way.
 *   "💋Loyer : 700 Dollars*"                already the page's loudest number
 *   "Garantie :4+1*"                        already KeyFacts and
 *                                           EntryCostsBreakdown, itemised
 *   "🥰Réf : Saio*"                         already the KeyFacts reference cell
 *   "📍 Localisation : Matonge/Kauka"       already the heading and the map
 *   "🏘️ Bonjour*" / "CHERS PARTENAIRES"     addressed to other agents
 *   "✨ Composition :"                       a section header, not a feature
 *   "✨NB: Visiter Guide S.v.p Vide"         trade instructions to an agent
 *
 * This is the same exclusion list services/openai.js's POINTS FORTS prompt
 * rules give the model for new listings ("ne répète pas dans features ce que
 * la fiche affiche déjà ailleurs"). New rows get it from the model; these
 * are the rows that predate it.
 */
const NOISE_PATTERNS = [
  // A phone number in any of the shapes agents write it.
  /\+?\d[\d\s.-]{7,}/,
  /\bcontacts?\b|\bt[ée]l\b|\bwhatsapp\b|\bappelez\b/i,
  // Facts the page already states as structured data.
  /\b(?:loyer|prix|price|garantie|avance|commission|caution)\b/i,
  /\br[ée]f(?:[ée]rence)?\s*[:.]/i,
  /\b(?:localisation|adresse|commune|quartier)\s*:/i,
  // Addressed to a person, not describing a property.
  /^(?:bonjour|bonsoir|salut|mbote|chers?|hello|hi)\b/i,
  // Agent-to-agent trade notes.
  /^nb\s*[:.]/i,
  // A section header, whatever its length — "Composition :" and
  // "APPAREMMENT AU PREMIER ÉTAGE COMPOSE :" are both introducing the list
  // rather than being an item in it.
  /:\s*$/,
  // "C/KASA VUBU" — the commune in the shorthand Kinshasa agents use. The
  // page already names it in the heading, the breadcrumb and the map.
  /^c\s*\/\s*\p{L}/iu,
];

/**
 * How many surviving lines make a list worth trusting.
 *
 * Three, not two, and that number is doing real work. Every filter above
 * removes lines; a message that comes out the far end with only two left is
 * almost always one where those two are what the filters happened not to
 * recognise, rather than a genuine feature list. Measured on real
 * production rows: at two, a message whose every real line was a price, a
 * reference and a phone number still produced a "key features" list reading
 * "Bonjour" and "Appartement Au Deuxieme Niveau… de KASA-VUBU". At three,
 * that message is correctly left alone and falls back to the keyword pass.
 */
const MIN_LINES = 3;

/**
 * Leading decoration agents open a line with — emoji, ticks, arrows — and
 * the trailing WhatsApp bold/italic markers they close one with. Stripped so
 * "✔️ 2 grandes chambres" becomes "2 grandes chambres": the feature is the
 * words, and the page draws its own check icon beside every item.
 *
 * Emoji INSIDE a line are left alone ("EAU💦 5/5" is how that agent writes
 * it and it reads fine); only the decorative bookends go.
 */
function stripDecoration(line) {
  return line
    // ONE class covering both emoji and list markers, not two passes: a real
    // line reads `*🏘️ Bonjour*`, where the WhatsApp bold marker sits outside
    // the emoji. Stripping emoji first leaves the `*` blocking it, and
    // stripping markers first leaves the emoji blocking them.
    .replace(/^[\s\-•*·–—\p{Extended_Pictographic} -⯿️‍]+/u, '')
    .replace(/[\s*_~]+$/, '')
    .trim();
}

/**
 * Lines from an agent's raw WhatsApp message that read as key features.
 *
 * Newlines only — no sentence splitting. A raw message that is one long
 * sentence is prose, and this returns [] for it rather than chopping it at
 * full stops; see the module comment for why an empty result is the right
 * answer and not a shortfall.
 *
 * @param {string} rawText
 * @returns {string[]}
 */
function featureLinesFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => stripDecoration(line)
      .replace(/^\d+[).]\s*/, '')
      .replace(/[.;,\s]+$/, '')
      .trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const seen = new Set();
  const kept = [];

  for (const line of lines) {
    if (line.length < MIN_LINE_CHARS || line.length > MAX_LINE_CHARS) continue;
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    // Nothing but punctuation and emoji survived the strip — not a feature.
    if (!/\p{L}{3}/u.test(line)) continue;

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
    if (kept.length >= MAX_LINES) break;
  }

  return kept.length >= MIN_LINES ? kept : [];
}

/**
 * ADD COLUMN IF NOT EXISTS — safe to re-run, and safe to run BEFORE the
 * engine change that writes the column is deployed (an unused nullable
 * column changes nothing). Running it after would mean every sync in
 * between failing with `column "features" does not exist`, which
 * syncListingToPostgres swallows — so the listing would silently never
 * reach the site at all. Same trap price_period/deposit_months already hit
 * in production; see web/CLAUDE.md's Known Gaps.
 */
async function ensureColumn({ postgres = postgresService } = {}) {
  await postgres.getPool().query('ALTER TABLE properties ADD COLUMN IF NOT EXISTS features text[]');
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @param {Object}  [options.db=dbService]
 * @param {Object}  [options.postgres=postgresService]
 * @returns {Promise<{scanned:number, eligible:number, updated:number, skipped:number, failed:number, changes:Array}>}
 */
async function runBackfill({ dryRun = false, db = dbService, postgres = postgresService } = {}) {
  const rows = db.db
    .prepare("SELECT * FROM listings WHERE status = 'published' AND remote_property_id IS NOT NULL")
    .all()
    .map(db.parseRow);

  const result = { scanned: rows.length, eligible: 0, updated: 0, skipped: 0, failed: 0, changes: [] };
  const pool = postgres.getPool();

  for (const row of rows) {
    // Whatever the extraction already produced wins — a row synced since the
    // engine change carries the model's own `features`, which is strictly
    // better than re-deriving them from the raw text here.
    const features = row.features?.length ? row.features : featureLinesFromText(row.raw_text);

    if (!features.length) {
      result.skipped += 1;
      continue;
    }
    result.eligible += 1;

    // Only ever fills a blank. A `features` already on the remote row was
    // either written by a real sync or by an earlier run of this script, and
    // overwriting it would let a stale local raw_text beat a fresher
    // extraction. `IS NULL OR = '{}'` because an empty array reaches the
    // column the same way a missing one does on some paths.
    if (dryRun) {
      result.changes.push({ id: row.id, propertyId: row.remote_property_id, features });
      continue;
    }

    try {
      const { rowCount } = await pool.query(
        `UPDATE properties SET features = $1, updated_at = NOW()
          WHERE id = $2 AND (features IS NULL OR cardinality(features) = 0)`,
        [features, row.remote_property_id],
      );
      if (rowCount > 0) {
        result.updated += 1;
        result.changes.push({ id: row.id, propertyId: row.remote_property_id, features });
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.failed += 1;
      console.error(`[features] listing #${row.id} -> property #${row.remote_property_id} failed: ${err.message}`);
    }
  }

  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const schemaOnly = process.argv.includes('--schema-only');

  if (!postgresService.isConfigured()) {
    console.error('[features] DB_HOST/DB_USER/DB_PASSWORD/DB_NAME are not all set — nothing to migrate.');
    process.exit(1);
  }

  if (!dryRun) {
    await ensureColumn();
    console.log('[features] properties.features ensured (text[], nullable)');
  } else {
    console.log('[features] dry run — the ALTER TABLE was NOT executed');
  }

  if (schemaOnly) {
    dbService.close();
    return;
  }

  const result = await runBackfill({ dryRun });
  console.log(
    `[features] scanned ${result.scanned} published listing(s): ${result.eligible} had usable lines, `
      + `${dryRun ? `${result.changes.length} would be written` : `${result.updated} written`}, `
      + `${result.skipped} left NULL (they fall back to the keyword pass), ${result.failed} failed.`,
  );

  for (const change of result.changes) {
    console.log(`  #${change.id} -> property #${change.propertyId}: ${JSON.stringify(change.features)}`);
  }

  dbService.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[features] fatal:', err);
    process.exit(1);
  });
}

module.exports = { featureLinesFromText, runBackfill, ensureColumn };
