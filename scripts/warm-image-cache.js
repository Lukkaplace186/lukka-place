/**
 * Pre-generates the storefront's resized photos (next/image variants) for
 * every listing photo at every width next/image can emit, so no visitor waits
 * ~600 ms for a first resize. Run on the VPS after anything that changes
 * photo URLs in bulk (scripts/backfill-photo-enhance.js, a bucket move).
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

const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://127.0.0.1:3002';

// Next 16 defaults: imageSizes + deviceSizes (next.config.mjs overrides neither).
const WIDTHS = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];

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

  const jobs = [];
  for (const { u } of rows) for (const w of WIDTHS) jobs.push([u, w]);
  console.log(`urls ${rows.length}, requests ${jobs.length}`);
  const tally = {};
  let done = 0;
  const t0 = Date.now();
  async function worker() {
    while (jobs.length) {
      const [u, w] = jobs.shift();
      let k;
      try {
        const r = await fetch(`${WEB_ORIGIN}/_next/image?url=${encodeURIComponent(u)}&w=${w}&q=75`, {
          headers: { accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
        });
        await r.arrayBuffer();
        k = r.ok ? r.headers.get('x-nextjs-cache') || 'other' : `http${r.status}`;
      } catch {
        k = 'err';
      }
      tally[k] = (tally[k] || 0) + 1;
      if (++done % 500 === 0) console.log(done, JSON.stringify(tally), `${((Date.now() - t0) / 1000) | 0}s`);
    }
  }
  await Promise.all([worker(), worker()]);
  console.log('done', done, JSON.stringify(tally), `${((Date.now() - t0) / 1000) | 0}s`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
