/**
 * Removes the old Laravel storefront's hero taglines from the `sliders` table.
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js: a plain
 * run prints exactly which rows would go and writes nothing.
 *
 *   node scripts/remove-legacy-slider-copy.js                 # dry run: lists the rows
 *   node scripts/remove-legacy-slider-copy.js --write         # backup to JSON, then delete
 *
 * WHY: those eight rows (four EN, four FR) held only the Laravel template's
 * taglines — "Search Congo's Largest Choice Homes", "Anywhere and Everywhere
 * in Congo", "Découvrez Le Plus Grand Choix de Logements au Congo"… — with an
 * empty title (checked 2026-10-27). lukkaplace.com never rendered `sliders`
 * (the homepage headline is web's home.hero.title), and web's /admin/cms no
 * longer reads or edits them (web/lib/cms.js). Nothing in this repo seeds
 * them, so once deleted they do not come back.
 *
 * WHAT IS DELETED: only rows whose `text` is one of LEGACY_TAGLINES exactly
 * (whitespace-trimmed) AND whose title is empty. A row someone has since
 * edited into real copy is left alone and listed as kept. With --write the
 * matched rows are written to a JSON backup first (path printed; restore =
 * INSERT those rows back), then deleted in one transaction. `cms_settings`
 * is not touched: none of its keys holds this copy.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const LEGACY_TAGLINES = [
  'The Best Place To Look For Your Next Home',
  'Believe In Finding It Here',
  "Search Congo's Largest Choice Homes",
  'Anywhere and Everywhere in Congo',
  'L’adresse Incontournable Pour Trouver Votre Prochain Logement',
  'Faites Nous Confiance, Votre Bien Est Ici',
  'Découvrez Le Plus Grand Choix de Logements au Congo',
  'Où Que Vous Soyez en RDC',
];

function isLegacyRow(row) {
  const text = String(row.text || '').trim();
  const title = String(row.title || '').trim();
  return title === '' && LEGACY_TAGLINES.includes(text);
}

async function main() {
  const write = process.argv.includes('--write');
  console.log(`Postgres : ${process.env.DB_HOST}/${process.env.DB_NAME}`);
  console.log(`Mode     : ${write ? 'WRITE (backup, then delete)' : 'DRY RUN — nothing will be written'}\n`);

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    // FOR UPDATE is refused inside a READ ONLY transaction, so the dry run reads plainly.
    const { rows } = await client.query(`SELECT * FROM sliders ORDER BY language_id, id${write ? ' FOR UPDATE' : ''}`);
    const remove = rows.filter(isLegacyRow);
    const keep = rows.filter((row) => !isLegacyRow(row));

    console.log(`sliders rows: ${rows.length} — would remove ${remove.length}, keep ${keep.length}\n`);
    for (const row of remove) {
      console.log(`  REMOVE #${row.id} (language ${row.language_id}) text="${row.text}" title="${row.title || ''}" image=${row.background_image || '—'}`);
    }
    for (const row of keep) {
      console.log(`  keep   #${row.id} (language ${row.language_id}) text="${row.text || ''}" title="${row.title || ''}"`);
    }

    if (!write || remove.length === 0) {
      await client.query('ROLLBACK');
      if (!write) console.log('\nDry run. Re-run with --write to back up and delete the REMOVE rows.');
      return;
    }

    const backup = path.resolve(`sliders-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backup, `${JSON.stringify(remove, null, 2)}\n`);
    console.log(`\nBackup written: ${backup}`);

    const ids = remove.map((row) => row.id);
    const result = await client.query('DELETE FROM sliders WHERE id = ANY($1::bigint[])', [ids]);
    await client.query('COMMIT');
    console.log(`Deleted ${result.rowCount} row(s).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
}

module.exports = { LEGACY_TAGLINES, isLegacyRow };
