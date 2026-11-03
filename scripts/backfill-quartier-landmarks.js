#!/usr/bin/env node
/**
 * scripts/backfill-quartier-landmarks.js
 *
 * Applies services/locations.js tidyListingLocation to listings already
 * stored: a landmark typed as the quartier ("Maison communale de Kintambo,
 * sur avenue") moves to the reference, and a quartier named only in the
 * reference ("Mbiza pigeon Référence maternité", Ngaliema → Binza Pigeon)
 * fills the empty quartier. The same rule intake and the sync now apply, so
 * there is one definition of "this is a landmark, not a quartier".
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js:
 *
 *   node scripts/backfill-quartier-landmarks.js            # dry run, prints every change
 *   node scripts/backfill-quartier-landmarks.js --write    # apply
 *
 * - Postgres `properties` (every row with a commune tag, pending included —
 *   web-created listings exist only there) and SQLite `listings` (drafts, and
 *   the intake row a later re-sync reads from, so the sync cannot put the old
 *   text back).
 * - Each UPDATE carries the values it read in its WHERE: a row edited between
 *   the read and the write is skipped, never overwritten.
 * - A listing code in the reference is never overwritten (the tidy leaves
 *   that row alone). Coordinates are not touched.
 */
require('dotenv').config();

const db = require('../services/db');
const postgres = require('../services/postgres');
const { tidyListingLocation, resolveCommune } = require('../services/locations');

/** The change for one row, or null. Exported for scripts/verify-pipeline.js. */
function planRow({ commune, quartier, reference }) {
  const canonical = commune ? resolveCommune(commune) || commune : null;
  const tidy = tidyListingLocation({ commune: canonical, quartier, reference });
  // A close spelling is a guess ("Mbudi" → "Mbuki", Mont-Ngafula, is two real
  // places): intake applies it to new text, a backfill never rewrites stored
  // text with one.
  if (!tidy.changed || tidy.how === 'close-spelling') return null;
  return { how: tidy.how, quartier: tidy.quartier || null, reference: tidy.reference || null };
}

const COMMUNE_SUBQUERY = `(
  SELECT ac.name FROM property_amenities pa
  JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
  WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
  LIMIT 1
)`;

async function main() {
  const write = process.argv.includes('--write');
  console.log(write ? 'MODE : WRITE\n' : 'MODE : DRY RUN — re-run with --write to apply\n');
  const counts = { postgres: 0, sqlite: 0, skipped: 0 };

  if (postgres.isConfigured()) {
    const pool = postgres.getPool();
    const { rows } = await pool.query(
      `SELECT p.id, p.quartier, p.reference, ${COMMUNE_SUBQUERY} AS commune
         FROM properties p
        WHERE p.deleted_at IS NULL AND (p.quartier IS NOT NULL OR p.reference IS NOT NULL)
        ORDER BY p.id`,
    );
    console.log(`Postgres: ${rows.length} properties with a quartier or reference`);
    for (const row of rows) {
      const plan = planRow(row);
      if (!plan) continue;
      console.log(`  property #${row.id} [${row.commune}] ${plan.how}`);
      console.log(`    quartier  ${JSON.stringify(row.quartier)} -> ${JSON.stringify(plan.quartier)}`);
      console.log(`    reference ${JSON.stringify(row.reference)} -> ${JSON.stringify(plan.reference)}`);
      counts.postgres += 1;
      if (!write) continue;
      const { rowCount } = await pool.query(
        `UPDATE properties SET quartier = $1, reference = $2, updated_at = NOW()
          WHERE id = $3 AND quartier IS NOT DISTINCT FROM $4 AND reference IS NOT DISTINCT FROM $5`,
        [plan.quartier, plan.reference, row.id, row.quartier, row.reference],
      );
      if (!rowCount) {
        counts.skipped += 1;
        console.log('    skipped — changed since it was read');
      }
    }
  } else {
    console.log('Postgres: not configured — SQLite only');
  }

  const listings = db.db
    .prepare('SELECT id, commune, quartier, reference, remote_property_id FROM listings WHERE commune IS NOT NULL ORDER BY id')
    .all();
  console.log(`\nSQLite  : ${listings.length} listings with a commune (${db.DB_PATH})`);
  const update = db.db.prepare(
    'UPDATE listings SET quartier = ?, reference = ? WHERE id = ? AND quartier IS ? AND reference IS ?',
  );
  for (const row of listings) {
    const plan = planRow(row);
    if (!plan) continue;
    const remote = row.remote_property_id ? ` (property #${row.remote_property_id})` : '';
    console.log(`  listing #${row.id}${remote} [${row.commune}] ${plan.how}: ` +
      `${JSON.stringify(row.quartier)} / ${JSON.stringify(row.reference)} -> ` +
      `${JSON.stringify(plan.quartier)} / ${JSON.stringify(plan.reference)}`);
    counts.sqlite += 1;
    if (write && !update.run(plan.quartier, plan.reference, row.id, row.quartier, row.reference).changes) {
      counts.skipped += 1;
    }
  }

  console.log(`\n${write ? 'Changed' : 'Would change'}: ${counts.postgres} properties, ${counts.sqlite} listings` +
    `${counts.skipped ? `, ${counts.skipped} skipped (edited meanwhile)` : ''}.`);
  db.close();
  if (postgres.isConfigured()) await postgres.getPool().end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`backfill failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { planRow };
