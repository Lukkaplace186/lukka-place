import 'server-only';
import { promises as dns } from 'node:dns';
import { getPool } from './db';
import { COMMUNE_SUBQUERY } from './listings';
import { SHORT_DESCRIPTION_CHARS } from './seoAuditRules';

/**
 * The reads behind /admin/seo that touch the network or the database. The
 * rules that interpret them are pure, in lib/seoAuditRules.js. Each one
 * degrades to an error value; the page renders what it has.
 */

const DNS_TIMEOUT_MS = 4000;
const DOMAIN = 'lukkaplace.com';

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/**
 * The domain's TXT records, looked up live: Google's
 * `google-site-verification=` (Search Console domain property) and Bing's
 * `MS=` record. A record being present is not Google having accepted it —
 * the owner still presses "Valider" — but its absence is certain failure.
 */
export async function getDomainVerification() {
  try {
    const records = (await withTimeout(dns.resolveTxt(DOMAIN), DNS_TIMEOUT_MS)).map((parts) => parts.join(''));
    return {
      ok: true,
      google: records.filter((r) => r.startsWith('google-site-verification=')).length,
      bing: records.some((r) => /^MS=ms\d+/i.test(r)),
    };
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
}

/**
 * The sitemap Google is given, counted by first path segment — built by the
 * same function that serves /sitemap.xml, so the count cannot drift from it.
 */
export async function getSitemapSummary() {
  try {
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();
    const bySection = {};
    for (const { url } of entries) {
      const section = `/${new URL(url).pathname.split('/')[1] || ''}`;
      bySection[section] = (bySection[section] || 0) + 1;
    }
    return { ok: true, total: entries.length, bySection };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Not concession: a walled compound with houses on it really has bedrooms.
const LAND_TYPES = ['terrain', 'ferme / terrain agricole'];
const SAMPLE_LIMIT = 25;

/**
 * What Google reads on our public listing pages, measured over every public
 * listing (same gate as the storefront): photos, a commune, a quartier, a
 * description long enough to say something, a price, and land that claims
 * bedrooms with no parcelle sub-type (a house filed as "Terrain": with no
 * sub-type, typeLabel falls back to the category and the title reads
 * "Terrain 3 chambres", listing #685 on 2026-11-05).
 */
export async function getListingSeoQuality() {
  const pool = getPool();
  const live = `
    WITH live AS (
      SELECT p.id, p.beds, p.price, p.quartier, p.parcelle_subtype, pc.title, pc.description, LOWER(catc.name) AS type,
             (SELECT COUNT(*)::int FROM property_slider_images si WHERE si.property_id = p.id) AS photos,
             ${COMMUNE_SUBQUERY}
        FROM properties p
        JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
        JOIN property_categories cat ON cat.id = p.category_id
        JOIN property_category_contents catc ON catc.category_id = cat.id AND catc.language_id = 26
       WHERE p.status = 1 AND p.approve_status = 1
    ),
    flagged AS (
      SELECT id, title, type, photos,
             (photos < 3) AS few_photos,
             (commune IS NULL) AS no_commune,
             (NULLIF(btrim(COALESCE(quartier, '')), '') IS NULL) AS no_quartier,
             (char_length(btrim(COALESCE(description, ''))) < $1) AS short_description,
             (price IS NULL OR price <= 0) AS no_price,
             (type = ANY ($2::text[]) AND parcelle_subtype IS NULL AND COALESCE(beds, 0) > 0) AS land_with_rooms
        FROM live
    )`;
  const [{ rows: [counts] }, { rows: sample }] = await Promise.all([
    pool.query(
      `${live}
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE few_photos)::int AS few_photos,
              COUNT(*) FILTER (WHERE no_commune)::int AS no_commune,
              COUNT(*) FILTER (WHERE no_quartier)::int AS no_quartier,
              COUNT(*) FILTER (WHERE short_description)::int AS short_description,
              COUNT(*) FILTER (WHERE no_price)::int AS no_price,
              COUNT(*) FILTER (WHERE land_with_rooms)::int AS land_with_rooms
         FROM flagged`,
      [SHORT_DESCRIPTION_CHARS, LAND_TYPES],
    ),
    pool.query(
      `${live}
       SELECT id, title, type, photos, few_photos, no_commune, no_quartier, short_description, no_price, land_with_rooms,
              (few_photos::int + no_commune::int + no_quartier::int + short_description::int + no_price::int + land_with_rooms::int) AS issues
         FROM flagged
        WHERE few_photos OR no_commune OR no_quartier OR short_description OR no_price OR land_with_rooms
        ORDER BY issues DESC, id DESC
        LIMIT $3`,
      [SHORT_DESCRIPTION_CHARS, LAND_TYPES, SAMPLE_LIMIT],
    ),
  ]);
  return { counts, sample };
}
