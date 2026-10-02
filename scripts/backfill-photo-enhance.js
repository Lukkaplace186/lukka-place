/**
 * Runs the photo correction (services/photoEnhance.js) over photos already
 * published — services/photoBackfill.js has the rules (always from the
 * untouched original, never on top of an older correction).
 *
 * SAFE BY DEFAULT, same convention as scripts/run-sql-migration.js:
 *
 *   node scripts/backfill-photo-enhance.js                    # analyse, write nothing; saves preview samples
 *   node scripts/backfill-photo-enhance.js --write            # upload corrected copies, warm them, repoint the URLs
 *   node scripts/backfill-photo-enhance.js --property 293     # one listing
 *   node scripts/backfill-photo-enhance.js --limit 20         # first 20 listings by id
 *   node scripts/backfill-photo-enhance.js --samples DIR      # where previews go (default ./photo-enhance-samples)
 *   node scripts/backfill-photo-enhance.js --sample-count 6   # how many previews (default 5)
 *   node scripts/backfill-photo-enhance.js --strength 0.60    # preview another LIGHTNESS_TARGET (dry run only)
 *   node scripts/backfill-photo-enhance.js --no-warm          # --write without pre-resizing (not recommended)
 *   node scripts/backfill-photo-enhance.js --rollback FILE    # put the URLs in a rollback map back
 *
 * A dry run also measures every photo it would correct: mean brightness of
 * the original vs the correction, so "never darker" is checked on the real
 * corpus, not only in tests. Each preview is three files: 1-original,
 * 2-current (what the site shows now, when that differs), 3-proposed.
 *
 * --write pre-resizes each listing's new photos through the storefront's
 * image optimiser (WEB_ORIGIN, default http://127.0.0.1:3002) BEFORE switching
 * that listing, then saves backfill-photo-enhance-<timestamp>.json (property,
 * old URL, new URL). Originals and older corrections are never deleted, so
 * --rollback is a complete undo.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const sharp = require('sharp');
const { getClient, isConfigured, BUCKET } = require('../services/supabaseStorage');
const { backfillPhotoEnhancement, rollbackPhotoEnhancement } = require('../services/photoBackfill');
const { DEFAULT_WEB_ORIGIN, warmUrls } = require('../services/imageCacheWarm');
const { LIGHTNESS_TARGET } = require('../services/photoEnhance');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
}

/** Mean luminance 0..255 of an encoded image. */
async function meanLuma(buffer) {
  const { channels } = await sharp(buffer).rotate().greyscale().stats();
  return channels[0].mean;
}

async function main() {
  const write = process.argv.includes('--write');
  const rollbackFile = argValue('--rollback');
  const propertyId = argValue('--property') ? Number.parseInt(argValue('--property'), 10) : null;
  const limit = argValue('--limit') ? Number.parseInt(argValue('--limit'), 10) : null;
  const samplesDir = argValue('--samples') || path.join(process.cwd(), 'photo-enhance-samples');
  const sampleCount = argValue('--sample-count') ? Number.parseInt(argValue('--sample-count'), 10) : 5;
  const strength = argValue('--strength') ? Number.parseFloat(argValue('--strength')) : null;
  const warmOrigin = process.env.WEB_ORIGIN || DEFAULT_WEB_ORIGIN;

  if (write && strength !== null) {
    console.error('--strength is for previews only. Set LIGHTNESS_TARGET in both photoEnhance.js copies to change what --write uses.');
    process.exitCode = 1;
    return;
  }

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
    const storage = getClient().storage.from(BUCKET);
    const warm = write && !process.argv.includes('--no-warm') ? (urls) => warmUrls(urls, { origin: warmOrigin }) : null;
    console.log(`Bucket   : ${BUCKET}`);
    console.log(`Strength : LIGHTNESS_TARGET ${strength ?? LIGHTNESS_TARGET}${strength !== null ? ' (preview override)' : ''}`);
    console.log(`Mode     : ${write ? `WRITE${warm ? `, warming via ${warmOrigin}` : ', NO warming'}` : 'DRY RUN — nothing will be written (re-run with --write)'}\n`);

    let saved = 0;
    const measured = { count: 0, darker: 0, sumDelta: 0, minDelta: Infinity };
    const onSample = write
      ? null
      : async (originalPath, original, after, { currentPath }) => {
          const delta = (await meanLuma(after)) - (await meanLuma(original));
          measured.count += 1;
          measured.sumDelta += delta;
          measured.minDelta = Math.min(measured.minDelta, delta);
          if (delta < -0.5) {
            measured.darker += 1;
            console.log(`  DARKER: ${originalPath} (${delta.toFixed(1)})`);
          }
          if (saved >= sampleCount) return;
          fs.mkdirSync(samplesDir, { recursive: true });
          const stem = originalPath.replace(/[\\/]/g, '_').replace(/\.[^.]+$/, '');
          fs.writeFileSync(path.join(samplesDir, `${stem}_1-original${path.extname(originalPath)}`), original);
          if (currentPath && currentPath !== originalPath) {
            const { data } = await storage.download(currentPath);
            if (data) fs.writeFileSync(path.join(samplesDir, `${stem}_2-current.jpg`), Buffer.from(await data.arrayBuffer()));
          }
          fs.writeFileSync(path.join(samplesDir, `${stem}_3-proposed.jpg`), after);
          saved += 1;
        };

    const { tally, changes } = await backfillPhotoEnhancement({
      pool,
      storage,
      supabaseUrl: process.env.SUPABASE_URL,
      bucket: BUCKET,
      enhanceOptions: strength !== null ? { lightnessTarget: strength } : {},
      warm,
      write,
      propertyId,
      limit,
      onSample,
    });

    console.log('\nSummary');
    console.log(`  listings               : ${tally.properties}`);
    console.log(`  photos                 : ${tally.photos}`);
    console.log(`  corrected              : ${tally.enhanced}`);
    console.log(`  needed nothing         : ${tally.alreadyFine}`);
    console.log(`  already this version   : ${tally.alreadyCurrent}`);
    console.log(`  no original found      : ${tally.noOriginal}`);
    console.log(`  not our bucket         : ${tally.foreign}`);
    console.log(`  failed (kept)          : ${tally.failed}`);
    if (write) console.log(`  listings not switched  : ${tally.notSwitched}`);
    if (measured.count) {
      console.log(`\nBrightness (mean luminance, correction vs original, ${measured.count} photos)`);
      console.log(`  average change : ${(measured.sumDelta / measured.count >= 0 ? '+' : '')}${(measured.sumDelta / measured.count).toFixed(1)}`);
      console.log(`  smallest change: ${measured.minDelta >= 0 ? '+' : ''}${measured.minDelta.toFixed(1)}`);
      console.log(`  darker         : ${measured.darker}`);
    }

    if (write && changes.length) {
      const file = path.join(process.cwd(), `backfill-photo-enhance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(file, JSON.stringify(changes, null, 2));
      console.log(`\nRollback map: ${file}`);
    }
    if (!write && saved) console.log(`\n${saved} preview(s) in ${samplesDir}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
