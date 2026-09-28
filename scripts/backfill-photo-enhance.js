/**
 * Runs the photo correction (services/photoEnhance.js) over photos already
 * published — services/photoBackfill.js has the rules.
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js:
 *
 *   node scripts/backfill-photo-enhance.js                    # analyse, write nothing; saves 5 before/after pairs
 *   node scripts/backfill-photo-enhance.js --write            # upload corrected copies, repoint the URLs
 *   node scripts/backfill-photo-enhance.js --property 293     # one listing
 *   node scripts/backfill-photo-enhance.js --limit 20         # first 20 listings by id
 *   node scripts/backfill-photo-enhance.js --samples DIR      # where the preview pairs go (default ./photo-enhance-samples)
 *   node scripts/backfill-photo-enhance.js --rollback FILE    # put the URLs in a rollback map back
 *
 * --write saves backfill-photo-enhance-<timestamp>.json (property, old URL,
 * new URL). Originals are never deleted, so --rollback is a complete undo.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getClient, isConfigured, BUCKET } = require('../services/supabaseStorage');
const { backfillPhotoEnhancement, rollbackPhotoEnhancement } = require('../services/photoBackfill');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
}

async function main() {
  const write = process.argv.includes('--write');
  const rollbackFile = argValue('--rollback');
  const propertyId = argValue('--property') ? Number.parseInt(argValue('--property'), 10) : null;
  const limit = argValue('--limit') ? Number.parseInt(argValue('--limit'), 10) : null;
  const samplesDir = argValue('--samples') || path.join(process.cwd(), 'photo-enhance-samples');

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`Postgres : ${process.env.DB_HOST}/${process.env.DB_NAME}`);

    if (rollbackFile) {
      const changes = JSON.parse(fs.readFileSync(rollbackFile, 'utf8'));
      const { restored } = await rollbackPhotoEnhancement({ pool, changes });
      console.log(`\n${restored} photo URL(s) restored.`);
      return;
    }

    if (!isConfigured()) {
      console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set — no photo can be read.');
      process.exitCode = 1;
      return;
    }
    console.log(`Bucket   : ${BUCKET}`);
    console.log(`Mode     : ${write ? 'WRITE' : 'DRY RUN — nothing will be written (re-run with --write)'}\n`);

    let saved = 0;
    const onSample = write
      ? null
      : async (objectPath, before, after) => {
          if (saved >= 5) return;
          fs.mkdirSync(samplesDir, { recursive: true });
          const stem = objectPath.replace(/[\/]/g, '_').replace(/\.[^.]+$/, '');
          fs.writeFileSync(path.join(samplesDir, `${stem}_before${path.extname(objectPath)}`), before);
          fs.writeFileSync(path.join(samplesDir, `${stem}_after.jpg`), after);
          saved += 1;
        };

    const { tally, changes } = await backfillPhotoEnhancement({
      pool,
      storage: getClient().storage.from(BUCKET),
      supabaseUrl: process.env.SUPABASE_URL,
      bucket: BUCKET,
      write,
      propertyId,
      limit,
      onSample,
    });

    console.log('\nSummary');
    console.log(`  listings         : ${tally.properties}`);
    console.log(`  photos           : ${tally.photos}`);
    console.log(`  corrected        : ${tally.enhanced}`);
    console.log(`  needed nothing   : ${tally.alreadyFine}`);
    console.log(`  already corrected: ${tally.alreadyEnhanced}`);
    console.log(`  not our bucket   : ${tally.foreign}`);
    console.log(`  failed (kept)    : ${tally.failed}`);

    if (write && changes.length) {
      const file = path.join(process.cwd(), `backfill-photo-enhance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify(changes, null, 2));
      console.log(`\nRollback map: ${file}`);
    }
    if (!write && saved) console.log(`\n${saved} before/after pair(s) in ${samplesDir}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
