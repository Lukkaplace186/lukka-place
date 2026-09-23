/**
 * One-off data correction (2026-09-23): live listings whose stored entry costs
 * contradict the agent's own "Garantie : N + N + N" wording.
 *
 * Two faults, both from before intake split the three postes apart:
 *   - the notation was SUMMED into deposit_months ("3 + 1 + 1" stored as 5,
 *     "5+1" as 6, "4+1" as 5), which the public site then read as "Garantie
 *     5 mois" and the /location pages averaged into their deposit figure;
 *   - or only the first figure was kept, dropping the advance / commission.
 *
 * Every row below was checked by hand against the listing's raw WhatsApp
 * text (quoted in `source`). Listings whose text is ambiguous — "800$ x 5",
 * "750$×3", an unqualified "4mois" — are deliberately NOT here: the agent
 * never said how that total splits, and guessing would invent a figure.
 *
 * Writes Postgres AND SQLite: syncListingToPostgres copies all three columns
 * from SQLite on the next publish/correction, so a Postgres-only fix would be
 * undone. Each row is only touched if its current Postgres values are exactly
 * the `from` values recorded here — anything else was changed since and is
 * reported, not overwritten.
 *
 *   node scripts/fix-summed-entry-costs.js           # dry run
 *   node scripts/fix-summed-entry-costs.js --write
 */
require('dotenv').config({ quiet: true });

const path = require('path');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'lukka_place.db');

// [deposit, advance, commission]; null = not stated.
const FIXES = [
  { id: 275, from: [6, null, null], to: [5, 1, null], source: 'Garantie: 5+1' },
  { id: 290, from: [5, null, null], to: [4, 1, null], source: 'Garantie 4+1mois' },
  { id: 292, from: [5, null, null], to: [3, 1, 1], source: 'Garantie : 3 + 1 + 1' },
  { id: 283, from: [5, null, null], to: [3, 1, 1], source: "GARANTIE DE 3+1+1MOIS D'AGENCE" },
  { id: 281, from: [3, null, null], to: [3, 1, 1], source: '1.500$ × 3 + 1 mois anticipatif · Commission : 1 mois' },
  { id: 285, from: [4, null, null], to: [4, null, 1], source: '600$ 4MOIS +1COM' },
  { id: 274, from: [4, null, null], to: [4, null, 1], source: 'Garantie : 4 mois + 1 mois de commission' },
  { id: 278, from: [3, null, null], to: [3, 1, null], source: 'Garantie : 3 mois +1' },
  { id: 270, from: [4, null, null], to: [4, 1, null], source: 'Prix: 1500$ 4+1' },
  { id: 273, from: [4, null, null], to: [4, 1, null], source: '500$×4+1' },
  { id: 280, from: [4, null, null], to: [4, 1, null], source: 'loyer: 1000$ 4+1' },
  { id: 284, from: [4, null, null], to: [4, 1, null], source: '400$ x 4+1' },
  { id: 271, from: [3, null, null], to: [3, 1, 1], source: 'prix 600$ 3+1+1' },
  { id: 291, from: [3, null, null], to: [3, 1, 1], source: 'Loyer :800$×3+1+1' },
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
