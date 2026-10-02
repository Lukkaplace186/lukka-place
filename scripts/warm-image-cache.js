/**
 * Pre-generates the storefront's resized photos (next/image variants) for
 * every listing photo at every width next/image can emit, so no visitor waits
 * ~600 ms for a first resize. Run on the VPS after anything that changes
 * photo URLs in bulk (a bucket move; scripts/backfill-photo-enhance.js now
 * warms each listing itself before switching it).
 *
 *   node scripts/warm-image-cache.js            # against http://127.0.0.1:3002
 *   WEB_ORIGIN=http://host:port node scripts/warm-image-cache.js
 *
 * Read-only on Postgres (BEGIN READ ONLY). The variants land in the web app's
 * .next/cache/images, which on production is a symlink to the permanent
 * /var/data/next-image-cache (web/CLAUDE.md, "Deployment").
 */
const { Pool } = require('pg');
require('dotenv').config({ quiet: true });
const { DEFAULT_WEB_ORIGIN, WARM_WIDTHS, warmUrls } = require('../services/imageCacheWarm');

const WEB_ORIGIN = process.env.WEB_ORIGIN || DEFAULT_WEB_ORIGIN;

(async () => {
  const p = new Pool({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });
  const c = await p.connect();
  await c.query('BEGIN READ ONLY');
  const { rows } = await c.query(
    `SELECT image AS u FROM property_slider_images WHERE image LIKE 'https://%'
     UNION SELECT featured_image FROM properties WHERE featured_image LIKE 'https://%'`,
  );
  await c.query('COMMIT');
  c.release();
  await p.end();

  console.log(`urls ${rows.length}, requests ${rows.length * WARM_WIDTHS.length}`);
  const t0 = Date.now();
  const tally = await warmUrls(
    rows.map((row) => row.u),
    {
      origin: WEB_ORIGIN,
      onProgress: (done, t) => {
        if (done % 500 === 0) console.log(done, JSON.stringify(t), `${((Date.now() - t0) / 1000) | 0}s`);
      },
    },
  );
  const done = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log('done', done, JSON.stringify(tally), `${((Date.now() - t0) / 1000) | 0}s`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
