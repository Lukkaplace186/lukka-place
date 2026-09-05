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
 *
 * Exported so lib/adminListings.js (the admin-side override editor, which has
 * a deliberately different authority model and therefore its own module) uses
 * this exact map rather than becoming a THIRD copy — the one thing
 * tests/unit/write-path-parity.js already exists to prevent.
 */
export const COMMUNE_AMENITY_IDS = {
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
export async function createListing({ agentId, vendorId, category, title, description, commune, price, purpose, beds, bath, area = null, quartier = null }) {
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
      // `area` is TEXT and carries '0' rather than NULL when unknown — the
      // schema's own convention, and what hasArea() checks for. Both fields
      // used to be hardcoded here, so every listing typed into the agent form
      // was permanently thinner than the same listing sent by WhatsApp.
      area: area != null ? String(area) : '0',
      quartier,
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

    const address = [quartier, commune, 'Kinshasa'].filter(Boolean).join(', ');
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

/**
 * One of this agent's own listings, with every field the native editor
 * (/compte/agent/biens/[id]/edit) writes back — scoped by agent_id in the
 * query itself, so an agent can never load a listing they don't own by
 * guessing an id. Returns null rather than throwing when there's no match,
 * so the page can render a real 404.
 *
 * Deliberately NOT getListingById() (lib/listings.js): that applies the
 * public APPROVED_FILTER, which would hide an agent's own pending or
 * rejected listing from its own edit form — the same reasoning
 * getOwnListingsForDashboard's doc comment gives.
 *
 * @param {number} agentId
 * @param {number|string} propertyId
 */
export async function getOwnListingForEdit(agentId, propertyId) {
  const id = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(id)) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.price, p.purpose, p.beds, p.bath, p.area, p.quartier, p.units_count,
            p.parcelle_subtype, p.reference, p.price_period, p.deposit_months,
            p.category_id, p.approve_status, p.listing_status, p.featured_image, p.sold_price,
            p.currency, p.price_original,
            pc.title, pc.description, pc.address,
            (
              SELECT COALESCE(array_agg(pa.amenity_id ORDER BY pa.amenity_id), ARRAY[]::bigint[])
              FROM property_amenities pa
              WHERE pa.property_id = p.id AND pa.amenity_id NOT BETWEEN 21 AND 44
            ) AS amenity_ids,
            (
              SELECT ac.name FROM property_amenities pa
              JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
              WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
              LIMIT 1
            ) AS commune,
            (
              SELECT COALESCE(array_agg(psi.image ORDER BY psi.id), ARRAY[]::text[])
              FROM property_slider_images psi WHERE psi.property_id = p.id
            ) AS gallery
     FROM properties p
     JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
     WHERE p.id = $2 AND p.agent_id = $3`,
    [CONTENT_LANGUAGE_ID, id, agentId],
  );

  const row = rows[0];
  if (!row) return null;
  // category_id is a bigint (a string out of node-postgres) — coerced for
  // the same reason getPropertyCategories() coerces its own id: every
  // `category.id === row.category_id` comparison downstream depends on it.
  return {
    ...row,
    id: Number(row.id),
    category_id: Number(row.category_id),
    // bigint[] comes back as strings — the editor compares these against the
    // numeric ids getFeatureAmenities() returns, so coerce once here rather
    // than at every comparison site.
    amenity_ids: (row.amenity_ids || []).map(Number),
  };
}

/**
 * The native editor's write path. Ownership is enforced in the UPDATE's own
 * WHERE clause (AND agent_id = $n), not merely by the caller having loaded
 * the row first.
 *
 * Three tables move together, so this runs in one transaction:
 *   properties          price, beds, bath, area, quartier, units_count, deposit_months
 *   property_contents   title, description, address (address is derived from
 *                       quartier + commune, matching createListing's own
 *                       `[commune, 'Kinshasa']` convention)
 *   property_amenities  the commune tag, which is a row in the 21-44
 *                       amenity-id range rather than a column (CLAUDE.md)
 *
 * `slug` is deliberately NOT regenerated on a title change: it is the
 * listing's public URL identity, and rewriting it would silently break every
 * already-shared link and every WhatsApp message carrying one.
 *
 * @returns {Promise<boolean>} false when the listing isn't this agent's.
 */
export async function updateListing(agentId, propertyId, {
  title, description, commune, price, priceOriginal, currency, beds, bath, area, quartier,
  unitsCount, depositMonths, amenityIds,
}) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // `price` is always the canonical USD figure (converted by the caller
    // when the agent authored in FC); `price_original` + `currency` record
    // what they actually typed. Keeping `price` single-currency is what lets
    // every WHERE price >= / <=, ORDER BY price and the engine's budgetScore
    // keep working untouched.
    const { rowCount } = await client.query(
      `UPDATE properties
       SET price = $1, price_original = $2, currency = $3, beds = $4, bath = $5, area = $6,
           quartier = $7, units_count = $8, deposit_months = $9, updated_at = NOW()
       WHERE id = $10 AND agent_id = $11`,
      [price, priceOriginal, currency, beds, bath, area, quartier, unitsCount, depositMonths, propertyId, agentId],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    const address = [quartier, commune, 'Kinshasa'].filter(Boolean).join(', ');
    await client.query(
      `UPDATE property_contents SET title = $1, description = $2, address = $3, updated_at = NOW()
       WHERE property_id = $4 AND language_id = $5`,
      [title, description, address, propertyId, CONTENT_LANGUAGE_ID],
    );

    // Re-tag the commune: clear whatever amenity row in the commune range is
    // currently there, then write the new one. A no-op when the commune did
    // not change, and correct when it did — an UPDATE alone would silently
    // save nothing on a listing that never had a commune tag to begin with
    // (every listing synced before 2026-08-15, see web/CLAUDE.md).
    await client.query(
      'DELETE FROM property_amenities WHERE property_id = $1 AND amenity_id BETWEEN 21 AND 44',
      [propertyId],
    );
    const communeAmenityId = commune ? COMMUNE_AMENITY_IDS[commune] : null;
    if (communeAmenityId) {
      await client.query(
        'INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
        [propertyId, communeAmenityId],
      );
    }

    // Feature amenities share this table with the commune tag above, split by
    // id range — setListingAmenities only ever touches ids outside 21-44, and
    // the commune DELETE above only ever touches ids inside it, so the two
    // writes cannot clobber each other. `undefined` means "the form didn't
    // submit an amenity section", which must leave them alone rather than
    // clearing them.
    if (amenityIds !== undefined) {
      await setListingAmenities(propertyId, amenityIds, client);
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replaces a listing's whole gallery with `urls`, in the given order, and
 * repoints featured_image at the first one.
 *
 * `property_slider_images` has NO sort column — verified directly against
 * the live schema (id, property_id, image, created_at, updated_at), and
 * every read path orders by `psi.id` (lib/listings.js's GALLERY_SUBQUERY).
 * So "reorder" here genuinely means rewriting the rows in the wanted order;
 * short of a migration there is no cheaper honest option. One transaction,
 * so a failure can never leave a listing with no photos at all.
 *
 * The Storage objects themselves are never deleted — a URL dropped from the
 * gallery just stops being referenced. Deliberate: the same object can be
 * re-added, and orphan cleanup is a separate concern from reordering.
 */
export async function setListingGallery(propertyId, urls) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM property_slider_images WHERE property_id = $1', [propertyId]);
    for (const url of urls) {
      await client.query(
        'INSERT INTO property_slider_images (property_id, image, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
        [propertyId, url],
      );
    }
    await client.query(
      'UPDATE properties SET featured_image = $1, updated_at = NOW() WHERE id = $2',
      [urls[0] || NO_PHOTO_URL, propertyId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Hard-deletes one of this agent's listings and its dependent rows.
 *
 * There is no soft-delete column on `properties`: `status` is the
 * active/enabled flag the public filter reads (status = 1 AND
 * approve_status = 1, CLAUDE.md) and `listing_status` is the sales
 * lifecycle — neither means "deleted". Rather than overload one of them this
 * removes the row for real, and the UI confirms destructively first.
 *
 * Child rows go first: these tables have no ON DELETE CASCADE, so a bare
 * DELETE on `properties` would either fail on the FK or strand orphans.
 *
 * @returns {Promise<boolean>} false when the listing isn't this agent's.
 */
export async function deleteListing(agentId, propertyId) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ownership proven here, before anything is removed, and the same
    // predicate is repeated on the final DELETE.
    const { rows } = await client.query(
      'SELECT id FROM properties WHERE id = $1 AND agent_id = $2 FOR UPDATE',
      [propertyId, agentId],
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query('DELETE FROM property_slider_images WHERE property_id = $1', [propertyId]);
    await client.query('DELETE FROM property_amenities WHERE property_id = $1', [propertyId]);
    await client.query('DELETE FROM property_contents WHERE property_id = $1', [propertyId]);
    await client.query('DELETE FROM properties WHERE id = $1 AND agent_id = $2', [propertyId, agentId]);

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Copies one of this agent's listings into a new, unpublished draft — the
 * Rightmove-style "duplicate" an agency needs when listing several
 * near-identical units in one building.
 *
 * The copy deliberately resets three things rather than cloning them:
 *   approve_status = 0   a duplicate is new content and goes back through
 *                        moderation; cloning an approval would publish
 *                        unreviewed copy instantly.
 *   listing_status       always 'active' — never inherits closed/under_offer.
 *   sold_price = NULL    belongs to the original transaction, not the copy.
 * `reference` is not copied either: it is the listing's own identifier
 * (CLAUDE.md), so two listings must never share one.
 *
 * @returns {Promise<number|null>} the new property id, or null if not owned.
 */
export async function duplicateListing(agentId, propertyId) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: sourceRows } = await client.query(
      `SELECT p.vendor_id, p.category_id, p.country_id, p.city_id, p.featured_image, p.price,
              p.purpose, p.type, p.beds, p.bath, p.area, p.quartier, p.units_count,
              p.parcelle_subtype, p.price_period, p.deposit_months,
              pc.title, pc.description, pc.address
       FROM properties p
       JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
       WHERE p.id = $2 AND p.agent_id = $3`,
      [CONTENT_LANGUAGE_ID, propertyId, agentId],
    );
    const source = sourceRows[0];
    if (!source) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: created } = await client.query(
      `INSERT INTO properties (
         vendor_id, agent_id, category_id, country_id, city_id, featured_image, price, purpose,
         type, beds, bath, area, quartier, units_count, parcelle_subtype, price_period,
         deposit_months, status, approve_status, listing_status, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1,0,'active',NOW(),NOW())
       RETURNING id`,
      [
        source.vendor_id, agentId, source.category_id, source.country_id, source.city_id,
        source.featured_image, source.price, source.purpose, source.type, source.beds, source.bath,
        source.area, source.quartier, source.units_count, source.parcelle_subtype,
        source.price_period, source.deposit_months,
      ],
    );
    const newId = created[0].id;

    const copyTitle = `${source.title} (copie)`.slice(0, 150);
    await client.query(
      `INSERT INTO property_contents (property_id, language_id, title, slug, address, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [newId, CONTENT_LANGUAGE_ID, copyTitle, `${slugify(copyTitle)}-${newId}`, source.address, source.description],
    );

    // Commune tag and gallery are real content, not identity — both copied so
    // the duplicate is genuinely ready to edit rather than a stub the agent
    // has to re-photograph. Same Storage URLs, no re-upload.
    await client.query(
      `INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at)
       SELECT $1, amenity_id, NOW(), NOW() FROM property_amenities WHERE property_id = $2`,
      [newId, propertyId],
    );
    await client.query(
      `INSERT INTO property_slider_images (property_id, image, created_at, updated_at)
       SELECT $1, image, NOW(), NOW() FROM property_slider_images WHERE property_id = $2 ORDER BY id`,
      [newId, propertyId],
    );

    await client.query('COMMIT');
    return Number(newId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The structured, selectable property features — everything in `amenities`
 * that is NOT one of the 21-44 commune rows.
 *
 * That id range is the whole contract: `property_amenities` stores a
 * listing's commune (CLAUDE.md — there is no commune column), and the same
 * table now also stores its real features. Splitting them by id range is what
 * lets both live in one table without either write path clobbering the other.
 * Seeded by scripts/migrate-currency-amenities-pitch.js, which places them at
 * 45+ precisely so this predicate is exact.
 *
 * Never a hardcoded option list — the rows come from the database, so an
 * amenity added or renamed there shows up here without a code change (same
 * principle as getPropertyCategories above).
 *
 * @returns {Promise<Array<{id: number, name: string, icon: string|null}>>}
 */
export async function getFeatureAmenities() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT a.id, a.icon, ac.name
     FROM amenities a
     JOIN amenity_contents ac ON ac.amenity_id = a.id AND ac.language_id = $1
     WHERE a.id NOT BETWEEN 21 AND 44 AND a.status = 1
     ORDER BY a.serial_number, ac.name`,
    [CONTENT_LANGUAGE_ID],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * Replaces a listing's feature amenities with `amenityIds`.
 *
 * The `NOT BETWEEN 21 AND 44` on the DELETE is load-bearing, not defensive
 * tidiness: without it this would wipe the listing's commune tag, which is
 * the only place its commune is stored. Ids are also intersected against the
 * real feature set before insert, so a crafted request cannot tag a listing
 * with a commune id through this path and silently relocate it.
 *
 * Runs inside a caller-supplied client when given one, so it can join the
 * updateListing transaction rather than committing separately.
 */
export async function setListingAmenities(propertyId, amenityIds, existingClient = null) {
  const pool = getPool();
  const client = existingClient || (await pool.connect());
  const ownsClient = !existingClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    const { rows: valid } = await client.query(
      `SELECT id FROM amenities WHERE id = ANY($1::bigint[]) AND id NOT BETWEEN 21 AND 44 AND status = 1`,
      [amenityIds.length ? amenityIds : [0]],
    );
    const allowed = valid.map((r) => Number(r.id));

    await client.query(
      'DELETE FROM property_amenities WHERE property_id = $1 AND amenity_id NOT BETWEEN 21 AND 44',
      [propertyId],
    );
    for (const amenityId of allowed) {
      await client.query(
        'INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
        [propertyId, amenityId],
      );
    }

    if (ownsClient) await client.query('COMMIT');
    return allowed;
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

/**
 * The Mes biens table's inline price cell — a narrower write than
 * updateListing() on purpose. That function requires the full field set
 * (title, description, commune, amenities…) because the native editor
 * submits all of them together; re-fetching and re-submitting every other
 * field just to change one number would be both wasted work and a wider
 * blast radius than the edit the agent actually asked for (a stale
 * description typed in another tab could silently get overwritten).
 *
 * Still dual-column and currency-aware: `price` stays canonical USD (the
 * caller has already converted a CDF figure via the dated rate before
 * calling this, same as updateListingAction does for the full editor), and
 * `priceOriginal`/`currency` are written alongside it so the two can never
 * drift out of sync with each other.
 *
 * @returns {Promise<boolean>} false when the listing isn't this agent's.
 */
export async function updateListingPrice(agentId, propertyId, { price, priceOriginal, currency }) {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties SET price = $1, price_original = $2, currency = $3, updated_at = NOW()
     WHERE id = $4 AND agent_id = $5`,
    [price, priceOriginal, currency, propertyId, agentId],
  );
  return rowCount > 0;
}
