/**
 * scripts/backfill-smart-paste-descriptions.js
 *
 * One-time back-catalogue cleanup for the Smart Paste feature (root
 * CLAUDE.md): re-runs every existing listing's own title+description text
 * through the same `parseListingTextForForm` extractor the agent dashboard's
 * "Auto-Fill from WhatsApp Text" button now uses, and replaces a messy
 * WhatsApp-style description (emojis, asterisks, ALL CAPS, bullet glyphs)
 * with the clean, professional one it generates.
 *
 * Deliberately narrower than "re-extract everything and overwrite the
 * record": a listing's structured columns (price, beds, bath, quartier, ...)
 * may have been corrected by the agent or an admin AFTER the original
 * WhatsApp text was written, and that text is exactly what this script feeds
 * back into the model — blindly overwriting a since-corrected column from a
 * stale source would be a real regression, not a cleanup. So:
 *
 *   - `description` (property_contents) is REPLACED whenever the existing
 *     text looks messy (see looksMessy()) — that's the actual ask.
 *   - Every OTHER field (beds, bath, quartier, parcelle_subtype, units_count,
 *     reference, deposit_months) is only ever filled when the column is
 *     currently NULL. An existing non-null value always wins. When the
 *     parsed value materially disagrees with an existing non-null value,
 *     that's logged as "ambiguous" for a human to look at — never
 *     auto-overwritten.
 *   - price/currency are never touched at all here — the financially
 *     sensitive field with the highest cost of a wrong auto-correction.
 *
 * Usage:
 *   node scripts/backfill-smart-paste-descriptions.js            (dry run — no writes)
 *   node scripts/backfill-smart-paste-descriptions.js --apply    (writes for real)
 *   node scripts/backfill-smart-paste-descriptions.js --apply --limit=5
 *
 * Requires the real OPENAI_API_KEY and Postgres (DB_HOST/DB_USER/DB_PASSWORD/
 * DB_NAME) env vars — same as the live engine process. Writes a full JSON
 * report to scripts/backfill-smart-paste-descriptions.report.json.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { getPool } = require('../services/postgres');
const { parseListingTextForForm } = require('../services/openai');

const CONTENT_LANGUAGE_ID = 20;
const REPORT_PATH = path.join(__dirname, 'backfill-smart-paste-descriptions.report.json');

const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number.parseInt(LIMIT_ARG.split('=')[1], 10) : null;

/** Same signal EXTRACTION_FAILURE_MARKERS-style checks elsewhere in this codebase use: is this text still raw WhatsApp copy, not a written listing description? */
function looksMessy(text) {
  const t = String(text || '');
  if (t.trim().length < 20) return true;
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const whatsappMarkup = /\*[^*]+\*/;
  const bullets = /[•▪●]/;
  const shoutyLine = /^[A-ZÀ-Ý0-9 !.,:;'"()/-]{12,}$/m;
  return emoji.test(t) || whatsappMarkup.test(t) || bullets.test(t) || shoutyLine.test(t);
}

/** Defensive cleanup mirroring web/lib/smartPaste.js's cleanDescription — kept as a small duplicate here rather than a cross-repo import, since this is a one-time script. */
function cleanDescription(text) {
  return String(text || '')
    .replace(/\*+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const FILLABLE_COLUMNS = [
  { column: 'beds', extractedKey: 'bedrooms' },
  { column: 'bath', extractedKey: 'bathrooms' },
  { column: 'quartier', extractedKey: 'quartier' },
  { column: 'parcelle_subtype', extractedKey: 'parcelle_subtype' },
  { column: 'units_count', extractedKey: 'units_count' },
  { column: 'reference', extractedKey: 'reference' },
  { column: 'deposit_months', extractedKey: 'deposit_months' },
];

async function run() {
  const pool = getPool();
  const { rows: listings } = await pool.query(
    `SELECT p.id, p.beds, p.bath, p.quartier, p.parcelle_subtype, p.units_count,
            p.reference, p.deposit_months, pc.id AS content_id, pc.title, pc.description
     FROM properties p
     JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
     ORDER BY p.id`,
    [CONTENT_LANGUAGE_ID],
  );

  const candidates = (LIMIT ? listings.slice(0, LIMIT) : listings).filter((l) => looksMessy(l.description));

  console.log(
    `[backfill] ${listings.length} listings total, ${candidates.length} with a messy description ` +
      `(${APPLY ? 'APPLY — writing for real' : 'DRY RUN — no writes'})`,
  );

  const report = { startedAt: new Date().toISOString(), apply: APPLY, updated: [], filledFields: [], ambiguous: [], failed: [] };

  for (const listing of candidates) {
    const sourceText = [listing.title, listing.description].filter(Boolean).join('\n\n');
    let extracted;
    try {
      ({ extracted_data: extracted } = await parseListingTextForForm(sourceText));
    } catch (err) {
      console.error(`[backfill] #${listing.id} extraction failed: ${err.message}`);
      report.failed.push({ id: listing.id, error: err.message });
      continue;
    }

    if (typeof extracted.confidence === 'number' && extracted.confidence < 0.4) {
      console.warn(`[backfill] #${listing.id} low confidence (${extracted.confidence}) — skipped, needs manual review`);
      report.ambiguous.push({ id: listing.id, reason: 'low_confidence', confidence: extracted.confidence });
      continue;
    }

    const newDescription = cleanDescription(extracted.description_fr);
    const fills = {};
    for (const { column, extractedKey } of FILLABLE_COLUMNS) {
      const existing = listing[column];
      const parsedValue = extracted[extractedKey];
      if (parsedValue == null) continue;
      if (existing == null) {
        fills[column] = parsedValue;
      } else if (String(existing) !== String(parsedValue)) {
        report.ambiguous.push({
          id: listing.id, reason: 'field_mismatch', column, existing, parsed: parsedValue,
        });
      }
    }

    console.log(
      `[backfill] #${listing.id}: description ${newDescription.length} chars` +
        (Object.keys(fills).length ? `, filling ${Object.keys(fills).join(', ')}` : ''),
    );

    if (APPLY) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE property_contents SET description = $1, updated_at = NOW() WHERE id = $2',
          [newDescription, listing.content_id],
        );
        const fillKeys = Object.keys(fills);
        if (fillKeys.length) {
          const setClause = fillKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
          await client.query(
            `UPDATE properties SET ${setClause}, updated_at = NOW() WHERE id = $${fillKeys.length + 1}`,
            [...fillKeys.map((k) => fills[k]), listing.id],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[backfill] #${listing.id} write failed: ${err.message}`);
        report.failed.push({ id: listing.id, error: err.message });
        client.release();
        continue;
      }
      client.release();
    }

    report.updated.push({
      id: listing.id,
      previousDescription: listing.description,
      newDescription,
      filled: fills,
    });
    if (Object.keys(fills).length) report.filledFields.push({ id: listing.id, filled: fills });
  }

  report.finishedAt = new Date().toISOString();
  report.summary = {
    totalListings: listings.length,
    candidates: candidates.length,
    updated: report.updated.length,
    listingsWithFilledFields: report.filledFields.length,
    ambiguous: report.ambiguous.length,
    failed: report.failed.length,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\n[backfill] summary:', report.summary);
  console.log(`[backfill] full report written to ${REPORT_PATH}`);

  await pool.end();
}

run().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
