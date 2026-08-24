/**
 * services/postgres.js
 *
 * Hybrid-sync: local SQLite (services/db.js) stays the fast, always-available
 * engine store; a *published* listing is additionally pushed to the Supabase
 * Postgres database the actual lukkaplace.com website and admin panel read
 * from — so it shows up in the site's pending-approval queue.
 *
 * This replaces an earlier attempt (services/mysql.js, now deleted) that
 * synced to a Hostinger MySQL database which turned out NOT to be what the
 * live site actually uses — confirmed by connecting directly and finding
 * property/vendor ids the website's own admin panel shows that don't exist
 * in that MySQL database at all.
 *
 * Field conventions below are not guessed: they're reverse-engineered from
 * real rows written by an earlier (now-dormant, last active 2026-08-09)
 * WhatsApp-to-property bot that used this exact database successfully —
 * several of its listings are already live and approved. Notable findings:
 *   - No vendor is created or required: bot-sourced properties use
 *     vendor_id = 0 (shows as "Admin" in the admin panel's "Post by" column).
 *     No vendor means no membership row is needed either.
 *   - `properties.type` is written capitalized ('Residential'/'Commercial'),
 *     independent of property_categories.type, which is lowercase.
 *   - `properties.area` is a text column here, not integer.
 *   - `property_contents` gets exactly one row, at language_id = 20 (the
 *     site's default/English slot) — even though the content itself is
 *     French/Lingala. The `language_id` here is a UI-locale bucket, not a
 *     claim about the text's actual language.
 *   - `featured_image` must be a full URL, not a bare filename — the site's
 *     own placeholder for "no photo yet" is
 *     https://lukkaplace.com/assets/img/noimage.jpg, used verbatim below when
 *     a listing has no downloaded photos, or Supabase Storage isn't
 *     configured. When photos exist, they're uploaded via
 *     services/supabaseStorage.js to the same bucket/path convention the
 *     old bot used, and the resulting public URLs are used instead.
 *
 * Never throws into the WhatsApp reply path — see services/db.js
 * publishListing, which calls this fire-and-forget.
 */

const { Pool } = require('pg');
const { uploadListingPhotos } = require('./supabaseStorage');
const { resolveCommune, resolveQuartier } = require('./locations');

// The site's own "no photo" asset — used verbatim so a WhatsApp listing with
// no successfully-downloaded image looks exactly like any other unphotographed
// listing on the site, rather than a broken link.
const NO_PHOTO_URL = 'https://lukkaplace.com/assets/img/noimage.jpg';

// The site's default/UI-locale language slot — see module doc comment for
// why French content is written here rather than under the French row.
const CONTENT_LANGUAGE_ID = 20;

function isConfigured() {
  return Boolean(
    process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME,
  );
}

let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // Supabase's pooler terminates TLS with a cert chain Node doesn't
      // always have locally trusted; the connection itself is still
      // encrypted, just not chain-verified.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Taxonomy — loaded once per process and cached. A restart is required to
// pick up a taxonomy change made in the website admin.
// ---------------------------------------------------------------------------

let taxonomyCache = null;

/** Strip accents and case for forgiving free-text matches. */
function normaliseText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** French category name -> { id, type }. */
async function loadCategories(client) {
  const { rows } = await client.query(
    `SELECT pc.id, pc.type, pcc.name
     FROM property_categories pc
     JOIN property_category_contents pcc ON pcc.category_id = pc.id
     WHERE pcc.language_id = 26`,
  );
  const map = new Map();
  for (const row of rows) map.set(normaliseText(row.name), { id: row.id, type: row.type });
  return map;
}

/** The site's DRC / Kinshasa location row IDs — state_id is null here to
 *  match the proven pattern from real WhatsApp-sourced listings. */
async function loadLocation(client) {
  const { rows: countryRows } = await client.query(
    `SELECT country_id FROM property_country_contents WHERE name ILIKE '%Congo%' LIMIT 1`,
  );
  const { rows: cityRows } = await client.query(
    `SELECT city_id FROM property_city_contents WHERE name ILIKE '%Kinshasa%' LIMIT 1`,
  );
  if (!countryRows.length || !cityRows.length) {
    throw new Error(
      'services/postgres.js: could not resolve DRC / Kinshasa in the property_*_contents tables — has the site\'s location taxonomy changed?',
    );
  }
  return { countryId: countryRows[0].country_id, cityId: cityRows[0].city_id };
}

async function loadTaxonomy(client) {
  if (taxonomyCache) return taxonomyCache;
  const categories = await loadCategories(client);
  const location = await loadLocation(client);
  taxonomyCache = { categories, location };
  return taxonomyCache;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

/**
 * Our property_type -> nearest-fit French category name. Unlike the earlier
 * MySQL attempt, this schema has a dedicated Entrepôt/Warehouse category, so
 * 'entrepot' gets an exact match instead of falling back to Bâtiment.
 */
const CATEGORY_FALLBACK_FR = {
  appartement: 'appartement',
  studio: 'appartement',
  villa: 'maison',
  maison: 'maison',
  duplex: 'duplex',
  chambre_salon: 'appartement',
  parcelle: 'terrain',
  terrain: 'terrain',
  bureau: 'batiment',
  boutique: 'boutique',
  entrepot: 'entrepot',
  immeuble: 'batiment',
  autre: 'appartement',
};

function resolveCategory(propertyType, categories) {
  const wanted = CATEGORY_FALLBACK_FR[propertyType] || CATEGORY_FALLBACK_FR.autre;
  const match = categories.get(normaliseText(wanted));
  if (match) return match;

  const fallback = categories.values().next().value;
  console.warn(
    `[postgres] no category match for property_type='${propertyType}' (wanted '${wanted}') — using '${fallback?.id}' as fallback`,
  );
  return fallback;
}

/** properties.type is capitalized here, independent of category.type's own casing. */
function capitalise(text) {
  const str = String(text || '');
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

const PROPERTY_TYPE_LABELS_FR = {
  appartement: 'Appartement',
  studio: 'Studio',
  villa: 'Villa',
  maison: 'Maison',
  duplex: 'Duplex',
  chambre_salon: 'Chambre salon',
  parcelle: 'Parcelle',
  terrain: 'Terrain',
  bureau: 'Bureau',
  boutique: 'Boutique',
  entrepot: 'Entrepôt',
  immeuble: 'Immeuble',
  autre: 'Bien immobilier',
};

function buildTitle(row) {
  const kind = PROPERTY_TYPE_LABELS_FR[row.property_type] || 'Bien immobilier';
  const action = row.transaction_type === 'vente' ? 'à vendre' : 'à louer';
  const beds = row.bedrooms ? `${row.bedrooms} chambre${row.bedrooms > 1 ? 's' : ''} — ` : '';
  const where = row.commune ? ` à ${row.commune}` : '';
  return `${beds}${kind} ${action}${where}`.trim();
}

function buildAddress(row) {
  const parts = [row.quartier, row.commune, 'Kinshasa'].filter(Boolean);
  return parts.join(', ');
}

/**
 * Resolve `properties.agent_id` by matching the real submitting WhatsApp
 * number (`row.wa_id`, E.164 without '+') against `agents.phone`.
 *
 * `agents.phone` was migrated 2026-08-19 from a 32-bit `integer` (which
 * could never hold a real E.164 number — 243997123456 overflows int4's
 * ~2.1B max) to `VARCHAR(32)`. That fixes the overflow, but there is still
 * no form constraining how a real phone number gets typed into that column
 * — '+243997123456', '243997123456', '0997123456' with spaces or dashes
 * are all plausible once the Laravel admin side grows real input. Comparing
 * raw strings would silently never match on formatting alone and quietly
 * defeat the whole mechanism, so both sides are digit-only normalised
 * before comparing — still an exact match, just one '+'/spaces/dashes
 * can't derail. This does NOT reconcile a local-format number (leading
 * trunk '0', no country code) against wa_id's E.164 form — that's a real
 * DRC dialling-convention decision, not something to guess at here.
 *
 * Currently a safe no-op in practice: the live `agents` table holds exactly
 * one row, and it's test/placeholder data, so this will resolve to `null`
 * for every real listing until real agent accounts with real phone numbers
 * exist. That's the correct behaviour, not a bug — `null` is what makes a
 * card fall back to the single central WhatsApp CTA, exactly as it does
 * today. Never fabricates a match.
 *
 * @param {import('pg').PoolClient} client
 * @param {string|null|undefined} waId
 * @returns {Promise<number|null>}
 */
async function resolveAgentId(client, waId) {
  if (!waId) return null;
  const digitsOnly = String(waId).replace(/\D/g, '');
  if (!digitsOnly) return null;
  const { rows } = await client.query(
    `SELECT id FROM agents WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`,
    [digitsOnly],
  );
  return rows[0]?.id ?? null;
}

/**
 * Build the `properties` INSERT/UPDATE values object — a pure function
 * (unlike syncListingToPostgres itself) so its shape is directly
 * unit-testable without a live Postgres connection. Takes the already
 * resolved `category` (services/postgres.js's own async taxonomy lookup),
 * `location` ({ countryId, cityId }), and `agentId` (resolveAgentId above)
 * rather than looking any of them up itself.
 *
 * @param {Object} row A parsed listing row (services/db.js getListing() shape).
 * @param {Object} params
 * @param {{id: number, type: string}} params.category
 * @param {{countryId: number, cityId: number}} params.location
 * @param {number|null} [params.agentId]
 */
function buildPropertyValues(row, { category, location, agentId = null }) {
  const purpose = row.transaction_type === 'vente' ? 'sale' : 'rent';
  const area = Number.isFinite(row.surface_area_sqm) ? String(Math.round(row.surface_area_sqm)) : '0';

  return {
    vendor_id: 0,
    agent_id: agentId,
    category_id: category.id,
    country_id: location.countryId,
    state_id: null,
    city_id: location.cityId,
    featured_image: NO_PHOTO_URL,
    price: row.price ?? null,
    purpose,
    type: capitalise(category.type),
    beds: row.bedrooms ?? null,
    bath: row.bathrooms ?? null,
    area,
    // Dedicated column (added 2026-08-15) for exact-match search filters —
    // the commune amenity tag and the free-text address (buildAddress) stay
    // as they were; this is additive, not a replacement for either.
    quartier: row.quartier ?? null,
    // Dedicated columns (added 2026-08-15) for the classification fields
    // introduced alongside the parcelle/appartement prompt rules — see
    // services/openai.js's PARCELLE_SUBTYPES. All three are nullable and
    // simply absent from most listings (an appartement has no
    // parcelle_subtype or units_count; most listings have no reference
    // code), so `?? null` is the whole story here — nothing else reads or
    // depends on these three, unlike quartier/commune.
    parcelle_subtype: row.parcelle_subtype ?? null,
    units_count: row.units_count ?? null,
    reference: row.reference ?? null,
    // Real intake data (services/db.js CORRECTABLE_FIELDS, services/openai.js's
    // extraction prompt) that used to be dropped here before reaching the
    // public site — added once `price_period`/`deposit_months` columns exist
    // on the live Supabase `properties` table (coordinate that migration
    // before deploying this change; the sync will fail with a Postgres
    // "column does not exist" error until it does). Powers web/'s "Garantie
    // N mois" badge — see web/lib/listings.js's SELECT_FIELDS.
    price_period: row.price_period ?? null,
    deposit_months: row.deposit_months ?? null,
    status: 1,
    approve_status: 0,
  };
}

/**
 * Kinshasa communes have no dedicated column anywhere in this schema (checked
 * directly against the live database: `properties`/`property_contents` carry
 * only state_id/city_id and a free-text address). The site instead tags a
 * commune through the generic `amenities` facility — ids 21-44 are, in
 * practice, the 24 communes: confirmed by querying `amenity_contents`
 * directly, which returns exactly 24 rows named for the 24 communes, in the
 * same alphabetical order this codebase already uses. Quartier has no
 * structured home in this schema at all (no equivalent table exists for it);
 * it only ever reaches Supabase via the free-text address (buildAddress).
 */
const COMMUNE_AMENITY_IDS = {
  Bandalungwa: 21, Barumbu: 22, Bumbu: 23, Gombe: 24, Kalamu: 25,
  'Kasa-Vubu': 26, Kimbanseke: 27, Kinshasa: 28, Kintambo: 29, Kisenso: 30,
  Lemba: 31, Limete: 32, Lingwala: 33, Makala: 34, Maluku: 35, Masina: 36,
  Matete: 37, 'Mont-Ngafula': 38, Ndjili: 39, Ngaba: 40, Ngaliema: 41,
  'Ngiri-Ngiri': 42, Nsele: 43, Selembao: 44,
};

/** property_contents.description is NOT NULL and the site itself requires >= 15 chars. */
function buildDescription(row) {
  const summary = row.summary_fr && row.summary_fr.trim();
  if (summary && summary.length >= 15) return summary;

  const parts = [
    PROPERTY_TYPE_LABELS_FR[row.property_type] || 'Bien immobilier',
    row.transaction_type === 'vente' ? 'à vendre' : 'à louer',
    row.commune ? `à ${row.commune}` : null,
    row.price ? `— ${row.price} ${row.currency || 'USD'}` : null,
  ].filter(Boolean);
  return `${parts.join(' ')}. Annonce reçue via WhatsApp, en attente de détails complémentaires.`;
}

function slugify(text) {
  return normaliseText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Defense in depth: routes/webhook.js already normalises commune/quartier
 * before a fresh extraction is stored, but a row can also reach the sync
 * layer un-normalised — a pre-resolver legacy row, or one written by a path
 * that bypassed the webhook (a direct services/db.js call, a future admin
 * edit, scripts/backfill-locations.js). Never let un-normalised text reach
 * the live site's amenity tag or its address column just because of *how*
 * the row got here. A no-op when both fields are already absent/canonical.
 *
 * @param {Object} row
 * @returns {Object} A shallow copy of `row` with commune/quartier resolved.
 */
function normaliseRowLocation(row) {
  if (!row || (!row.commune && !row.quartier)) return row;

  const resolvedCommune = row.commune ? resolveCommune(row.commune) || row.commune : row.commune;
  const resolvedQuartier = row.quartier
    ? resolveQuartier(row.quartier, resolvedCommune) || row.quartier
    : row.quartier;

  return { ...row, commune: resolvedCommune, quartier: resolvedQuartier };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Insert or update this listing's row on the website's Supabase database.
 * No-ops (logged) if DB_HOST/DB_USER/DB_PASSWORD/DB_NAME aren't all set, so
 * this is always safe to call — including from the test suite.
 *
 * @param {Object} row  A parsed listing row from services/db.js (getListing()
 *        shape — `photos`/`amenities` already decoded to arrays).
 * @returns {Promise<number|null>} The Postgres `properties.id`, or null if skipped.
 */
async function syncListingToPostgres(row) {
  if (!isConfigured()) {
    console.log('[postgres] DB_HOST/DB_USER/DB_PASSWORD/DB_NAME not fully set — skipping sync');
    return null;
  }
  if (!row) {
    throw new Error('syncListingToPostgres requires a listing row');
  }

  row = normaliseRowLocation(row);

  const client = await getPool().connect();
  try {
    const { categories, location } = await loadTaxonomy(client);
    const category = resolveCategory(row.property_type, categories);
    const agentId = await resolveAgentId(client, row.wa_id);
    const hasPhotos = Array.isArray(row.photos) && row.photos.length > 0;

    await client.query('BEGIN');

    let propertyId = row.remote_property_id;
    const wasInsert = !propertyId;

    const propertyValues = buildPropertyValues(row, { category, location, agentId });

    if (propertyId) {
      const setClause = Object.keys(propertyValues)
        .map((key, i) => `${key} = $${i + 1}`)
        .join(', ');
      await client.query(
        `UPDATE properties SET ${setClause}, updated_at = NOW() WHERE id = $${Object.keys(propertyValues).length + 1}`,
        [...Object.values(propertyValues), propertyId],
      );
    } else {
      const keys = Object.keys(propertyValues);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await client.query(
        `INSERT INTO properties (${keys.join(', ')}, created_at, updated_at)
         VALUES (${placeholders}, NOW(), NOW())
         RETURNING id`,
        Object.values(propertyValues),
      );
      propertyId = rows[0].id;
    }

    const title = buildTitle(row);
    const address = buildAddress(row);
    const description = buildDescription(row);
    const slug = `${slugify(title)}-${propertyId}`;

    const { rows: existingContent } = await client.query(
      'SELECT id FROM property_contents WHERE property_id = $1 AND language_id = $2',
      [propertyId, CONTENT_LANGUAGE_ID],
    );
    if (existingContent.length) {
      await client.query(
        `UPDATE property_contents SET title = $1, slug = $2, address = $3, description = $4, updated_at = NOW()
         WHERE id = $5`,
        [title, slug, address, description, existingContent[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO property_contents
           (property_id, language_id, title, slug, address, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [propertyId, CONTENT_LANGUAGE_ID, title, slug, address, description],
      );
    }

    // Tag the commune via the site's repurposed-amenity convention (see
    // COMMUNE_AMENITY_IDS above). Clear any prior commune tag first so
    // correcting a listing's commune doesn't leave the old one also checked —
    // scoped to just the 24 commune ids, never touching a real amenity
    // (piscine, forage, ...) the agent's listing separately carries.
    const communeAmenityId = COMMUNE_AMENITY_IDS[row.commune];
    await client.query(
      'DELETE FROM property_amenities WHERE property_id = $1 AND amenity_id = ANY($2::bigint[])',
      [propertyId, Object.values(COMMUNE_AMENITY_IDS)],
    );
    if (communeAmenityId) {
      await client.query(
        'INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
        [propertyId, communeAmenityId],
      );
    }

    await client.query('COMMIT');

    // Semantic-search groundwork (services/embeddings.js) — best-effort and
    // deliberately isolated from the transaction above, same posture as the
    // photo upload just below: an OpenAI-side failure here must never risk
    // or roll back an otherwise-successful property sync (that's exactly
    // the historical price_period/deposit_months bug class — a write that
    // silently never happened because it shared a fate with something
    // unrelated). Embedding stays NULL on failure and gets picked up by
    // scripts/backfill-embeddings.js's next sweep (`WHERE embedding IS
    // NULL`); the real property_id is already committed and returned either
    // way. Required lazily (not at module top) to avoid a require() cycle —
    // services/embeddings.js itself imports buildTitle/buildAddress/
    // buildDescription from this module.
    try {
      const { buildEmbeddingInput, generateEmbedding } = require('./embeddings');
      const pgvector = require('pgvector');
      const embedding = await generateEmbedding(buildEmbeddingInput(row));
      await client.query('UPDATE properties SET embedding = $1::vector WHERE id = $2', [
        pgvector.toSql(embedding),
        propertyId,
      ]);
    } catch (err) {
      console.error(`[embeddings] generation failed for property #${propertyId}: ${err.message}`);
    }

    // Photo upload is network I/O against a different service — deliberately
    // outside the DB transaction above, and best-effort: a Storage hiccup
    // must not undo an otherwise-successful property sync.
    let uploadedUrls = [];
    if (hasPhotos) {
      uploadedUrls = await uploadListingPhotos(row.photos, propertyId).catch((err) => {
        console.warn(`[postgres] photo upload failed for listing #${row.id}: ${err.message}`);
        return [];
      });
    }

    if (uploadedUrls.length) {
      await client.query('UPDATE properties SET featured_image = $1, updated_at = NOW() WHERE id = $2', [
        uploadedUrls[0],
        propertyId,
      ]);
      await client.query('DELETE FROM property_slider_images WHERE property_id = $1', [propertyId]);
      for (const url of uploadedUrls) {
        await client.query(
          'INSERT INTO property_slider_images (property_id, image, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
          [propertyId, url],
        );
      }
    }

    console.log(
      `[postgres] listing #${row.id} -> properties#${propertyId} (${wasInsert ? 'inserted' : 'updated'}), ` +
        `vendor_id=0, approve_status=pending, category=${category.id}, ` +
        `commune=${communeAmenityId ? `amenity#${communeAmenityId}` : 'unmatched'}, ` +
        `photos=${uploadedUrls.length}${hasPhotos && !uploadedUrls.length ? ' (upload failed or unconfigured — using noimage.jpg placeholder)' : ''}`,
    );

    return propertyId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  syncListingToPostgres,
  isConfigured,
  // Exposed for tests / inspection.
  resolveCategory,
  buildTitle,
  buildAddress,
  buildDescription,
  slugify,
  capitalise,
  buildPropertyValues,
  resolveAgentId,
  CATEGORY_FALLBACK_FR,
  COMMUNE_AMENITY_IDS,
  normaliseRowLocation,
  NO_PHOTO_URL,
};
