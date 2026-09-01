import 'server-only';
import { getPool } from './db';

/**
 * Manual listing creation from the agent self-service dashboard
 * (web/app/compte/agent/biens) — a second write path onto the same
 * `properties`/`property_contents`/`property_amenities` tables the WhatsApp
 * intake pipeline writes via lukka-place-engine/services/postgres.js's
 * `syncListingToPostgres`. Field conventions (vendor_id, NO_PHOTO_URL
 * placeholder, `type` capitalisation, the commune-via-amenity-id tagging)
 * are copied from that module rather than re-derived, so a manually-created
 * listing looks identical to a bot-sourced one to every read path.
 */

const CONTENT_LANGUAGE_ID = 20;
const CATEGORY_LANGUAGE_ID = 26;

const NO_PHOTO_URL = 'https://lukkaplace.com/assets/img/noimage.jpg';

/**
 * Duplicated from lukka-place-engine/services/postgres.js's
 * COMMUNE_AMENITY_IDS — that module lives in a separate app (the Express
 * engine) this Next.js app can't import from, and commune-as-amenity-id
 * isn't exposed by the engine's GET /locations endpoint (that only returns
 * commune *names*). Keep both copies in sync if a commune is ever renamed.
 */
const COMMUNE_AMENITY_IDS = {
  Bandalungwa: 21, Barumbu: 22, Bumbu: 23, Gombe: 24, Kalamu: 25,
  'Kasa-Vubu': 26, Kimbanseke: 27, Kinshasa: 28, Kintambo: 29, Kisenso: 30,
  Lemba: 31, Limete: 32, Lingwala: 33, Makala: 34, Maluku: 35, Masina: 36,
  Matete: 37, 'Mont-Ngafula': 38, Ndjili: 39, Ngaba: 40, Ngaliema: 41,
  'Ngiri-Ngiri': 42, Nsele: 43, Selembao: 44,
};

function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Real, DB-backed property types for the "Type de bien" select — never a
 * hardcoded list, so an option always maps to a real category_id.
 * @returns {Promise<Array<{id: number, type: string, name: string}>>}
 */
export async function getPropertyCategories() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT pc.id, pc.type, pcc.name
     FROM property_categories pc
     JOIN property_category_contents pcc ON pcc.category_id = pc.id AND pcc.language_id = $1
     ORDER BY pcc.name`,
    [CATEGORY_LANGUAGE_ID],
  );
  // category_id is a bigint column — node-postgres returns bigint as a
  // string to avoid silent precision loss, so this must be coerced back to
  // a real number here or every `category.id === parsedInt` comparison
  // downstream (createListingAction's allow-list check) silently fails.
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * The site's DRC / Kinshasa location row ids — same ILIKE lookup as the
 * engine's loadLocation(), since this app is Kinshasa-only and has no UI for
 * picking a different country/city.
 * @returns {Promise<{countryId: number, cityId: number}>}
 */
async function resolveKinshasaLocation(client) {
  const { rows: countryRows } = await client.query(
    `SELECT country_id FROM property_country_contents WHERE name ILIKE '%Congo%' LIMIT 1`,
  );
  const { rows: cityRows } = await client.query(
    `SELECT city_id FROM property_city_contents WHERE name ILIKE '%Kinshasa%' LIMIT 1`,
  );
  if (!countryRows.length || !cityRows.length) {
    throw new Error('Could not resolve DRC / Kinshasa in the property_*_contents tables.');
  }
  return { countryId: countryRows[0].country_id, cityId: cityRows[0].city_id };
}

function capitalise(text) {
  const str = String(text || '');
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Inserts one property (+ its property_contents row + its commune amenity
 * tag) in a single transaction. Photos are handled separately by the caller
 * (attachListingPhotos below) since the storage path needs the real
 * property id this returns.
 *
 * @param {Object} input
 * @param {number} input.agentId
 * @param {number} input.vendorId
 * @param {{id: number, type: string}} input.category
 * @param {string} input.title
 * @param {string} input.description
 * @param {string|null} input.commune
 * @param {number} input.price
 * @param {'rent'|'sale'} input.purpose
 * @param {number|null} input.beds
 * @param {number|null} input.bath
 * @returns {Promise<number>} the new properties.id
 */
export async function createListing({ agentId, vendorId, category, title, description, commune, price, purpose, beds, bath }) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const location = await resolveKinshasaLocation(client);

    await client.query('BEGIN');

    const propertyValues = {
      vendor_id: vendorId,
      agent_id: agentId,
      category_id: category.id,
      country_id: location.countryId,
      city_id: location.cityId,
      featured_image: NO_PHOTO_URL,
      price,
      purpose,
      type: capitalise(category.type),
      beds,
      bath,
      area: '0',
      quartier: null,
      price_period: purpose === 'rent' ? 'mois' : null,
      status: 1,
      approve_status: 0,
    };

    const keys = Object.keys(propertyValues);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(
      `INSERT INTO properties (${keys.join(', ')}, created_at, updated_at)
       VALUES (${placeholders}, NOW(), NOW())
       RETURNING id`,
      Object.values(propertyValues),
    );
    const propertyId = rows[0].id;

    const address = [commune, 'Kinshasa'].filter(Boolean).join(', ');
    const slug = `${slugify(title)}-${propertyId}`;
    await client.query(
      `INSERT INTO property_contents (property_id, language_id, title, slug, address, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [propertyId, CONTENT_LANGUAGE_ID, title, slug, address, description],
    );

    const communeAmenityId = commune ? COMMUNE_AMENITY_IDS[commune] : null;
    if (communeAmenityId) {
      await client.query(
        'INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
        [propertyId, communeAmenityId],
      );
    }

    await client.query('COMMIT');
    return propertyId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sets the property's cover photo (first URL) and its full slider gallery.
 * Deliberately outside createListing's transaction, same reasoning as
 * services/postgres.js's own photo step: a Storage hiccup shouldn't roll
 * back an otherwise-successful listing row.
 *
 * @param {number} propertyId
 * @param {string[]} urls
 */
export async function attachListingPhotos(propertyId, urls) {
  if (!urls.length) return;

  const pool = getPool();
  await pool.query('UPDATE properties SET featured_image = $1, updated_at = NOW() WHERE id = $2', [
    urls[0],
    propertyId,
  ]);
  for (const url of urls) {
    await pool.query(
      'INSERT INTO property_slider_images (property_id, image, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
      [propertyId, url],
    );
  }
}
