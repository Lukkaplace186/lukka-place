/**
 * One-off data correction (2026-11-19): live listings whose garantie / avance /
 * commission "months" hold an amount, so the page told tenants "9 000 mois
 * d'avance" or "20 mois de commission".
 *
 * Three causes, each fixed in code the same day (verify-pipeline §120):
 *   - amounts typed into the dashboard's "(mois)" fields: "9000" as the avance
 *     of a 3 000 $ rent. Where the amount is a whole number of rents, that
 *     number of months is what the agent stated (9000 ÷ 3000 = 3);
 *   - "garantie 4+1 + 20$ eau et courant": the additive rule read the 20 $
 *     water-and-power charge as 20 months of commission. Commission: not stated;
 *   - "Prix. 500+4": a rent plus a duration read as 500 months of garantie.
 *     How that 4 splits is not said, so garantie and avance become not stated
 *     (the 2026-09-23 fix left "4mois" the same way rather than guess).
 *
 * Writes Postgres AND SQLite (syncListingToPostgres copies all three columns
 * from SQLite on the next publish/correction). A row is only touched if its
 * current Postgres values are exactly the `from` values recorded here.
 *
 *   node scripts/fix-entry-cost-amounts.js           # dry run
 *   node scripts/fix-entry-cost-amounts.js --write
 */
require('dotenv').config({ quiet: true });

const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db');

// [deposit, advance, commission]; null = not stated.
const FIXES = [
  // agent #144, Lubumbashi: avance typed as an amount, always 3 rents
  { id: 324, from: [3, 9000, 1], to: [3, 3, 1], source: 'avance 9000 ÷ loyer 3000' },
  { id: 485, from: [3, 60000, 1], to: [3, 3, 1], source: 'avance 60000 ÷ loyer 20000' },
  { id: 514, from: [3, 8400, 1], to: [3, 3, 1], source: 'avance 8400 ÷ loyer 2800' },
  { id: 515, from: [3, 6000, 1], to: [3, 3, 1], source: 'avance 6000 ÷ loyer 2000' },
  { id: 517, from: [3, 21000, 1], to: [3, 3, 1], source: 'avance 21000 ÷ loyer 7000' },
  { id: 522, from: [3, 8400, 1], to: [3, 3, 1], source: 'avance 8400 ÷ loyer 2800' },
  { id: 532, from: [3, 12000, 1], to: [3, 3, 1], source: 'avance 12000 ÷ loyer 4000' },
  { id: 757, from: [3, 9000, 1], to: [3, 3, 1], source: 'avance 9000 ÷ loyer 3000' },
  { id: 759, from: [3, 15000, 1], to: [3, 3, 1], source: 'avance 15000 ÷ loyer 5000' },
  { id: 831, from: [3, 60000, 1], to: [3, 3, 1], source: 'avance 60000 ÷ loyer 20000' },
  // agent #108: avance typed as one rent
  { id: 617, from: [6, 2000, 1], to: [6, 1, 1], source: 'avance 2000 ÷ loyer 2000' },
  { id: 618, from: [4, 900, 1], to: [4, 1, 1], source: 'avance 900 ÷ loyer 900' },
  { id: 619, from: [4, 600, 1], to: [4, 1, 1], source: 'avance 600 ÷ loyer 600' },
  { id: 620, from: [4, 1500, 1], to: [4, 1, 1], source: 'avance 1500 ÷ loyer 1500' },
  // one rent typed into garantie / commission
  { id: 569, from: [350, null, 350], to: [1, null, 1], source: 'garantie 350 et commission 350 ÷ loyer 350' },
  { id: 762, from: [3, 3, 350], to: [3, 3, 1], source: 'commission 350 ÷ loyer 350' },
  // WhatsApp text misread by the additive rule
  { id: 872, from: [500, 4, 1], to: [null, null, 1], source: 'Prix. 500+4' },
  { id: 974, from: [4, 1, 20], to: [4, 1, null], source: 'garantie 4+1 / + 20$ eau et courant' },
  { id: 983, from: [4, 1, 20], to: [4, 1, null], source: 'garantie 4+1 / + 20$ eau et courant' },
  { id: 993, from: [4, 1, 20], to: [4, 1, null], source: 'garantie 4+1 / + 20$ eau et courant' },
];

const same = (a, b) => a.length === b.length && a.every((v, i) => (v ?? null) === (b[i] ?? null));
const fmt = (v) => v.map((x) => (x == null ? '–' : x)).join('/');

async function main() {
  const write = process.argv.includes('--write');
  console.log(write ? 'MODE: --write' : 'MODE: dry run (nothing written)');

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  const sqlite = new Database(SQLITE_PATH, { readonly: !write, fileMustExist: true });
  console.log(`SQLite: ${SQLITE_PATH}`);
  const updateSqlite = write
    ? sqlite.prepare('UPDATE listings SET deposit_months = ?, advance_months = ?, commission_months = ? WHERE remote_property_id = ?')
    : null;

  try {
    await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    const planned = [];
    for (const fix of FIXES) {
      const { rows } = await client.query(
        `SELECT deposit_months, advance_months, commission_months FROM properties WHERE id = $1${write ? ' FOR UPDATE' : ''}`,
        [fix.id],
      );
      if (!rows[0]) {
        console.log(`#${fix.id}: not found — skipped`);
        continue;
      }
      const now = [rows[0].deposit_months, rows[0].advance_months, rows[0].commission_months];
      if (same(now, fix.to)) {
        console.log(`#${fix.id}: already ${fmt(fix.to)}`);
        continue;
      }
      if (!same(now, fix.from)) {
        console.log(`#${fix.id}: is ${fmt(now)}, expected ${fmt(fix.from)} — changed since the check, skipped`);
        continue;
      }
      console.log(`#${fix.id}: ${fmt(now)} -> ${fmt(fix.to)}   « ${fix.source} »`);
      planned.push(fix);
      if (write) {
        await client.query(
          'UPDATE properties SET deposit_months = $1, advance_months = $2, commission_months = $3 WHERE id = $4',
          [...fix.to, fix.id],
        );
      }
    }
    if (!write) {
      await client.query('ROLLBACK');
      console.log(`\n${planned.length} row(s) would change.`);
      return;
    }
    // SQLite first inside its own transaction; Postgres commits only if it succeeded.
    const applySqlite = sqlite.transaction((fixes) => fixes.map((f) => updateSqlite.run(...f.to, f.id).changes));
    const changes = applySqlite(planned);
    await client.query('COMMIT');
    console.log(`\n${planned.length} property row(s) updated in Postgres; SQLite rows updated: ${changes.reduce((a, b) => a + b, 0)}.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
