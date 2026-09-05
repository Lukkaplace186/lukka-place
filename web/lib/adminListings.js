import 'server-only';
import { getPool } from './db';
import { COMMUNE_AMENITY_IDS } from './agentListings';

/**
 * Admin-side listing reads and overrides.
 *
 * Deliberately separate from lib/agentListings.js, which enforces
 * `AND agent_id = $n` on every single statement. That ownership scoping is
 * the whole point of that module and must never be weakened; an admin needs
 * to reach any listing on the platform, including the ~23 that have no agent
 * attached at all. Two modules with two different, explicit authority models
 * beats one module with a "skip the ownership check" flag that someone will
 * eventually pass from the wrong place.
 *
 * Nothing here bypasses moderation semantics: `approve_status` still moves
 * only through app/admin/listings/actions.js, which additionally runs the
 * publishability guard. This module changes listing DATA.
 */

const CONTENT_LANGUAGE_ID = 20;
const CATEGORY_LANGUAGE_ID = 26;

/**
 * One listing, with everything the admin editor writes back. NO approval
 * filter — that is the entire reason this exists rather than reusing
 * lib/listings.js's getListingById, which correctly refuses to return a
 * pending or rejected listing. A moderator has to be able to open exactly
 * those.
 */
export async function getListingForAdmin(propertyId) {
  const id = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(id)) return null;

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.price, p.price_original, p.currency, p.purpose, p.beds, p.bath, p.area,
            p.quartier, p.units_count, p.parcelle_subtype, p.reference, p.price_period,
            p.deposit_months, p.category_id, p.status, p.approve_status, p.listing_status,
            p.sold_price, p.sold_at, p.archived_at, p.featured_image, p.latitude, p.longitude,
            p.agent_id, p.vendor_id, p.created_at, p.updated_at,
            pc.title, pc.description, pc.address, pc.slug,
            a.username AS agent_username, a.phone AS agent_phone, a.agency_name,
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
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id = $2`,
    [CONTENT_LANGUAGE_ID, id],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    category_id: row.category_id == null ? null : Number(row.category_id),
    agent_id: row.agent_id == null ? null : Number(row.agent_id),
  };
}

/** Real categories, for the editor's type select. Same shape agentListings uses. */
export async function getCategoriesForAdmin() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT cat.id, catc.name, cat.type
     FROM property_categories cat
     JOIN property_category_contents catc ON catc.category_id = cat.id AND catc.language_id = $1
     WHERE cat.status = 1
     ORDER BY catc.name`,
    [CATEGORY_LANGUAGE_ID],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * Full metadata override on any listing.
 *
 * `slug` is deliberately never regenerated, exactly as in the agent editor:
 * it is the listing's public URL identity, and rewriting it on a title fix
 * breaks every already-shared link and every WhatsApp message carrying one.
 *
 * `undefined` means "the form did not submit this field" and leaves the
 * column alone; `null` means "clear it". The distinction matters because the
 * admin editor is used for one-field corrections far more often than for a
 * full rewrite, and a naive object spread would blank everything not typed.
 *
 * @returns {Promise<boolean>} false when there is no such listing.
 */
export async function adminUpdateListing(propertyId, patch) {
  const id = Number.parseInt(propertyId, 10);
  if (!Number.isFinite(id)) return false;

  const pool = getPool();
  const client = await pool.connect();

  const COLUMNS = {
    price: 'price',
    priceOriginal: 'price_original',
    currency: 'currency',
    purpose: 'purpose',
    beds: 'beds',
    bath: 'bath',
    area: 'area',
    quartier: 'quartier',
    unitsCount: 'units_count',
    parcelleSubtype: 'parcelle_subtype',
    reference: 'reference',
    pricePeriod: 'price_period',
    depositMonths: 'deposit_months',
    categoryId: 'category_id',
    listingStatus: 'listing_status',
    soldPrice: 'sold_price',
    soldAt: 'sold_at',
    latitude: 'latitude',
    longitude: 'longitude',
    agentId: 'agent_id',
    status: 'status',
  };

  try {
    await client.query('BEGIN');

    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(COLUMNS)) {
      if (patch[key] === undefined) continue;
      values.push(patch[key]);
      sets.push(`${column} = $${values.length}`);
    }

    if (sets.length) {
      values.push(id);
      const { rowCount } = await client.query(
        `UPDATE properties SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
        values,
      );
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
    }

    if (patch.title !== undefined || patch.description !== undefined || patch.commune !== undefined) {
      // property_contents may genuinely not exist for a listing (the
      // moderation queue LEFT JOINs it for exactly this reason), so this is
      // an UPDATE-then-INSERT rather than a bare UPDATE that would silently
      // save nothing.
      const address = [patch.quartier ?? null, patch.commune ?? null, 'Kinshasa'].filter(Boolean).join(', ');
      const { rowCount } = await client.query(
        `UPDATE property_contents
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             address = $3,
             updated_at = NOW()
         WHERE property_id = $4 AND language_id = $5`,
        [patch.title ?? null, patch.description ?? null, address, id, CONTENT_LANGUAGE_ID],
      );
      if (rowCount === 0) {
        await client.query(
          `INSERT INTO property_contents (property_id, language_id, title, slug, address, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            id,
            CONTENT_LANGUAGE_ID,
            patch.title || `Bien #${id}`,
            `bien-${id}`,
            address,
            patch.description || '',
            ],
        );
      }
    }

    // Commune is a property_amenities row in the 21-44 id range, not a
    // column (CLAUDE.md). DELETE-then-INSERT rather than UPDATE, because a
    // listing that never had a commune tag has no row for an UPDATE to hit —
    // the exact gap that left 6 approved listings untagged.
    if (patch.commune !== undefined) {
      await client.query(
        'DELETE FROM property_amenities WHERE property_id = $1 AND amenity_id BETWEEN 21 AND 44',
        [id],
      );
      const amenityId = patch.commune ? COMMUNE_AMENITY_IDS[patch.commune] : null;
      if (amenityId) {
        await client.query(
          'INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
          [id, amenityId],
        );
      }
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
 * Admin visibility override — the same `status` flag the agent's own
 * "Archiver" uses, reachable for any listing including ones with no agent.
 * Used for the "Suspendre" moderation action: content that is approved but
 * must come off the site right now, without rejecting it (which would tell
 * the agent it was refused) and without deleting anything.
 */
export async function adminSetListingVisible(propertyId, visible) {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE properties SET status = $1, archived_at = $2, updated_at = NOW() WHERE id = $3`,
    [visible ? 1 : 0, visible ? null : new Date(), propertyId],
  );
  return rowCount > 0;
}

/**
 * Listings an admin has suspended or that were archived by their agent —
 * approved content that is deliberately not on the site right now.
 *
 * A fourth moderation queue beside pending/approved/rejected, and a real
 * one: `status = 0 AND approve_status = 1` was previously invisible
 * everywhere in /admin, so a suspended listing simply disappeared from the
 * console with no way to find it again.
 */
export async function getSuspendedListings() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT p.id, p.price, p.purpose, p.beds, p.featured_image, p.quartier, p.listing_status,
            p.archived_at, p.sold_price, p.sold_at, p.agent_id,
            pc.title, a.username AS agent_username
     FROM properties p
     LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.status = 0 AND p.approve_status = 1
     ORDER BY COALESCE(p.archived_at, p.updated_at) DESC NULLS LAST`,
    [CONTENT_LANGUAGE_ID],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}
