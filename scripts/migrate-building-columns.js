#!/usr/bin/env node
/**
 * scripts/migrate-building-columns.js
 *
 * Adds multi-unit building support to the live Supabase `properties` table.
 *
 * WHY
 * ---
 * One WhatsApp paste can describe several distinct apartments in one building
 * ("3 ch 1500$, 3 ch 900$, 2 ch 600$"). services/db.js's expandAndPublishListing
 * turns that into one listing row per layout — each independently searchable and
 * priced — and stamps every one of them with a shared `parent_building_id`.
 *
 * Without that column on the Postgres side the grouping is lost the moment the
 * listings reach the storefront, and the map draws N markers stacked on one
 * coordinate instead of a single building pin.
 *
 * WHAT IT DOES
 * ------------
 *   ALTER TABLE properties ADD COLUMN parent_building_id uuid        -- nullable
 *   ALTER TABLE properties ADD COLUMN building_name      text        -- nullable
 *   CREATE INDEX idx_properties_parent_building_id ON properties (parent_building_id)
 *
 * Both columns are NULLABLE with no default and no constraint, so:
 *   - every existing row stays valid and untouched (no table rewrite, no
 *     lock beyond the brief catalogue update),
 *   - nothing reads them until the new engine code ships, and
 *   - services/postgres.js probes for the column at runtime, so the engine is
 *     safe to deploy either before or after this migration.
 *
 * price_min / price_max / available_units_count are deliberately NOT added:
 *   they are derivable from the child rows at query time, and a stored
 *   aggregate that drifts from its own units is the same class of bug as the
 *   summed "Garantie : 5 mois" this codebase already fixed once.
 *
 * SAFETY
 * ------
 * Idempotent — safe to run twice. Every statement is IF NOT EXISTS, and the
 * script reports what it actually changed rather than assuming.
 *
 * USAGE
 *   node scripts/migrate-building-columns.js --dry-run   # show the plan, change nothing
 *   node scripts/migrate-building-columns.js             # apply
 *
 * Reads the same DB_HOST/DB_USER/DB_PASSWORD/DB_NAME from .env that
 * services/postgres.js uses. This touches PRODUCTION data — the database the
 * public storefront queries directly.
 */

require('dotenv').config();

const { getPool, isConfigured } = require('../services/postgres');

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  {
    what: 'properties.parent_building_id (uuid, nullable)',
    check: `SELECT 1 FROM information_schema.columns
             WHERE table_name = 'properties' AND column_name = 'parent_building_id'`,
    sql: 'ALTER TABLE properties ADD COLUMN IF NOT EXISTS parent_building_id uuid',
  },
  {
    what: 'properties.building_name (text, nullable)',
    check: `SELECT 1 FROM information_schema.columns
             WHERE table_name = 'properties' AND column_name = 'building_name'`,
    sql: 'ALTER TABLE properties ADD COLUMN IF NOT EXISTS building_name text',
  },
  {
    what: 'index idx_properties_parent_building_id',
    check: `SELECT 1 FROM pg_indexes
             WHERE tablename = 'properties' AND indexname = 'idx_properties_parent_building_id'`,
    // Grouping the map by building means filtering on this column on every
    // map query; without the index that is a sequential scan of properties.
    sql: `CREATE INDEX IF NOT EXISTS idx_properties_parent_building_id
            ON properties (parent_building_id)
          WHERE parent_building_id IS NOT NULL`,
  },
];

(async () => {
  if (!isConfigured()) {
    console.error('DB_HOST/DB_USER/DB_PASSWORD/DB_NAME are not fully set — nothing to do.');
    process.exit(1);
  }

  const client = await getPool().connect();
  let applied = 0;

  try {
    console.log(DRY_RUN ? 'DRY RUN — nothing will be changed.\n' : 'Applying migration...\n');

    for (const step of STATEMENTS) {
      const { rows } = await client.query(step.check);
      if (rows.length) {
        console.log(`  = already present: ${step.what}`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  + WOULD ADD: ${step.what}\n      ${step.sql.replace(/\s+/g, ' ')}`);
        continue;
      }
      await client.query(step.sql);
      applied += 1;
      console.log(`  + added: ${step.what}`);
    }

    // Report the real state afterwards rather than trusting the statements.
    const { rows: verify } = await client.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'properties'
          AND column_name IN ('parent_building_id', 'building_name')
        ORDER BY column_name`,
    );
    console.log('\nproperties now has:');
    for (const col of verify) {
      console.log(`  ${col.column_name} — ${col.data_type}, nullable=${col.is_nullable}`);
    }
    if (!verify.length) console.log('  (neither column — nothing was applied)');

    console.log(DRY_RUN ? '\nDry run complete.' : `\nDone — ${applied} change(s) applied.`);
  } catch (err) {
    console.error(`\nMigration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await getPool().end();
  }
})();
