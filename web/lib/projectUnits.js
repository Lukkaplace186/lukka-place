import 'server-only';
import { getPool } from './db';
import { attachListingPhotos, createListing, deleteListing, getPropertyCategories } from './agentListings';
import { unitListingDescription, unitListingTitle, unitListingState } from './developmentRules';

/**
 * lib/projectUnits.js — a building's units that are ready now, as real listings.
 *
 * A unit type ticked "Disponible maintenant" gets individual units (Apt 1A,
 * 1B…), and each is created through the SAME path an agent's typed listing
 * takes (lib/agentListings.js createListing): same columns, same commune tag,
 * same approve_status = 0, same moderation, same storefront. What it adds is
 * only what makes it a unit of this building:
 *
 *   development_id / development_unit_type_id   — back to the project
 *   unit_label / unit_floor                     — "Apt 3B", 3
 *   parent_building_id = developments.building_uuid, building_name
 *       → lib/buildingGroups.js already turns listings sharing a building id
 *         into ONE map pin with a drawer listing each unit
 *   latitude / longitude = the project's own pin (when set)
 *       → every unit of the building is at the building
 *
 * Photos: the project's REAL photos only, never its renders. A listing's
 * gallery is read as photographs of the property; an architect's image there
 * would be presented as one. So units cannot be created before the project
 * has at least one real photo (`requiresPhoto`).
 *
 * Units are created approve_status 0 and are approved with the project (or,
 * on a project already public, when the team acknowledges the change) —
 * lib/developments.js setProjectPublished / acknowledgeProjectChanges.
 *
 * Plan limits: a unit linked to a project does not take a listing slot
 * during the launch (lib/listingQuotaRules.js QUOTA_COUNTED_SQL).
 */

/** Appartement for a building's units unless the unit type names another real category. */
async function resolveCategory(categoryId) {
  const categories = await getPropertyCategories();
  const byId = categories.find((c) => c.id === Number(categoryId));
  if (byId) return byId;
  return categories.find((c) => /appartement/i.test(c.name) || /appartement/i.test(c.type)) || categories[0] || null;
}

/** Why units cannot be created for this project/unit type right now, or null. */
export function unitCreationBlocker(project, unitType) {
  if (project.kind !== 'building') return 'notBuilding';
  if (!unitType?.ready_now) return 'notReady';
  if (!(project.photos || []).filter(Boolean).length) return 'requiresPhoto';
  if (!project.commune) return 'requiresCommune';
  return null;
}

/**
 * Create the listings for `units` ([{label, floor, price}], already validated
 * by validateUnitInput) in one transaction: all of them or none.
 *
 * @param {Object} args
 * @param {Object} args.project    the developer's project (getAgentProject / getProjectForAdmin)
 * @param {Object} args.unitType   one of project.unit_types
 * @param {Array}  args.units
 * @param {number} args.agentId    the listing's agent — the project's developer
 * @param {number} args.vendorId
 * @returns {Promise<number[]>} the new property ids
 */
export async function createUnitListings({ project, unitType, units, agentId, vendorId }) {
  const blocker = unitCreationBlocker(project, unitType);
  if (blocker) throw new Error(`units cannot be created: ${blocker}`);
  if (!units.length) return [];
  const category = await resolveCategory(unitType.category_id);
  if (!category) throw new Error('no property category to file the units under');

  const photos = (project.photos || []).filter(Boolean).slice(0, 10);
  const hasPin = project.latitude !== null && project.longitude !== null
    && Number.isFinite(Number(project.latitude)) && Number.isFinite(Number(project.longitude));

  const client = await getPool().connect();
  const ids = [];
  try {
    await client.query('BEGIN');
    for (const unit of units) {
      const purpose = unitType.purpose === 'rent' ? 'rent' : 'sale';
      const id = await createListing({
        client,
        agentId,
        vendorId,
        category,
        title: unitListingTitle(project, unitType, unit),
        description: unitListingDescription(project, unitType, unit),
        commune: project.commune,
        price: unit.price,
        purpose,
        beds: unitType.bedrooms ?? null,
        bath: unitType.bathrooms ?? null,
        area: unitType.area_m2 !== null && unitType.area_m2 !== undefined ? Math.round(Number(unitType.area_m2)) : null,
        quartier: project.quartier || null,
        reference: `${project.name} — ${unit.label}`.slice(0, 120),
        extra: {
          development_id: project.id,
          development_unit_type_id: unitType.id,
          unit_label: unit.label,
          unit_floor: unit.floor,
          parent_building_id: project.building_uuid,
          building_name: project.name,
          latitude: hasPin ? project.latitude : null,
          longitude: hasPin ? project.longitude : null,
          price_period: purpose === 'rent' ? (unitType.price_period === 'year' ? 'an' : 'mois') : null,
        },
      });
      await attachListingPhotos(id, photos, client);
      ids.push(Number(id));
    }
    await client.query('COMMIT');
    return ids;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove a unit that has never been public (approve_status 0) — a typo in the
 * generator. A unit that has been public is closed or archived from Mes biens
 * like any listing, so its history is kept.
 */
export async function deletePendingUnit(agentId, developmentId, propertyId) {
  const { rows } = await getPool().query(
    `SELECT id, approve_status, status, listing_status FROM properties
     WHERE id = $1 AND agent_id = $2 AND development_id = $3`,
    [propertyId, agentId, developmentId],
  );
  if (!rows[0] || unitListingState(rows[0]) !== 'pending') return false;
  return deleteListing(agentId, propertyId);
}
