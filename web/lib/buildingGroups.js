/**
 * lib/buildingGroups.js
 *
 * Collapses the units of one multi-unit building into a single map pin.
 *
 * THE PROBLEM
 * -----------
 * A WhatsApp paste describing four apartments in one building publishes as
 * four listing rows (services/db.js's expandAndPublishListing), each sharing a
 * `parent_building_id`. That is exactly what we want in search results — every
 * layout is independently findable and priced — but on the map those four rows
 * carry the SAME address, so they resolve to the same coordinate and stack into
 * one visible marker with three hidden underneath it.
 *
 * lib/mapPinSpread.js fans co-located pins apart, which is right for listings
 * that merely happen to share a spot. It is wrong here: these four really are
 * at one address, and scattering them around a ring invents four buildings.
 *
 * So: group first, fan afterwards. A building becomes ONE pin labelled with its
 * unit count and price range; the units live inside the pin's drawer.
 *
 * Pure and geometry-free on purpose — the Maps browser key is
 * HTTP-referrer-restricted and localhost is not allow-listed (web/CLAUDE.md),
 * so none of this is exercisable in a browser here. Everything that decides
 * what a visitor sees is therefore a plain function over plain data, driven by
 * tests/unit/building-groups.test.js.
 */

/**
 * Group listings by building.
 *
 * Order is preserved: a group appears at the position of its first member, so
 * whatever ordering the caller applied (price, recency) still reads correctly.
 *
 * A listing with no `parent_building_id` is its own group of one — which is
 * every ordinary listing, and also every listing when the storefront has not
 * yet been migrated to select that column. That case must stay byte-identical
 * to the pre-grouping behaviour, since it is the overwhelming majority.
 *
 * @param {Array<Object>} listings
 * @returns {Array<{key: string, buildingId: string|null, isBuilding: boolean,
 *   listings: Object[], unitCount: number, priceMin: number|null,
 *   priceMax: number|null, bedsMin: number|null, bedsMax: number|null,
 *   buildingName: string|null, representative: Object}>}
 */
export function groupListingsByBuilding(listings) {
  const groups = [];
  const byBuilding = new Map();

  for (const listing of listings || []) {
    if (!listing) continue;

    const buildingId = listing.parent_building_id || null;

    // No building id — a group of one, never merged with anything.
    if (!buildingId) {
      groups.push(makeGroup(`listing:${listing.id}`, null, [listing]));
      continue;
    }

    const existing = byBuilding.get(buildingId);
    if (existing) {
      existing.listings.push(listing);
      continue;
    }

    const group = makeGroup(`building:${buildingId}`, buildingId, [listing]);
    byBuilding.set(buildingId, group);
    groups.push(group);
  }

  // Totals are computed only once every member is in — a running min/max would
  // be wrong for any group whose second unit arrives after the first.
  return groups.map(finaliseGroup);
}

function makeGroup(key, buildingId, listings) {
  return { key, buildingId, listings };
}

function finaliseGroup(group) {
  const { listings } = group;
  const prices = listings.map((l) => toNumber(l.price)).filter((n) => n !== null);
  const beds = listings.map((l) => toNumber(l.beds ?? l.bedrooms)).filter((n) => n !== null);

  // A "building" is only a building once it actually holds more than one unit.
  // A group of one renders as an ordinary price pin — drawing "🏢 1 Unité"
  // would be a worse pin than the price it replaced.
  const isBuilding = Boolean(group.buildingId) && listings.length > 1;

  return {
    ...group,
    isBuilding,
    unitCount: listings.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    bedsMin: beds.length ? Math.min(...beds) : null,
    bedsMax: beds.length ? Math.max(...beds) : null,
    buildingName: listings.find((l) => l.building_name)?.building_name || null,
    // The unit whose position and address speak for the whole building. The
    // cheapest one, deliberately: it is the number the pin leads with ("De
    // 600$"), so the pin and the listing behind it agree.
    representative: cheapest(listings),
  };
}

function cheapest(listings) {
  let best = listings[0];
  let bestPrice = toNumber(best?.price);
  for (const listing of listings.slice(1)) {
    const price = toNumber(listing.price);
    if (price !== null && (bestPrice === null || price < bestPrice)) {
      best = listing;
      bestPrice = price;
    }
  }
  return best;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The label a building pin carries: unit count plus price range.
 *
 * Formatting stays here rather than in the pin renderer so it can be tested
 * without a map — "🏢 4 unités · 600$–1 500$".
 *
 * @param {Object} group        A groupListingsByBuilding() entry.
 * @param {Function} [formatPrice] Injected money formatter; defaults to a
 *        bare integer + $, which is what the price pins already show.
 */
export function buildingPinLabel(group, formatPrice = defaultPrice) {
  const unitWord = group.unitCount > 1 ? 'unités' : 'unité';
  const count = `🏢 ${group.unitCount} ${unitWord}`;

  if (group.priceMin === null) return count;
  if (group.priceMax === null || group.priceMin === group.priceMax) {
    return `${count} · ${formatPrice(group.priceMin)}`;
  }
  return `${count} · ${formatPrice(group.priceMin)}–${formatPrice(group.priceMax)}`;
}

/** "2 à 3 ch." / "3 ch." — omitted entirely when no unit states its bedrooms. */
export function buildingBedroomsLabel(group) {
  if (group.bedsMin === null) return null;
  if (group.bedsMax === null || group.bedsMin === group.bedsMax) return `${group.bedsMin} ch.`;
  return `${group.bedsMin} à ${group.bedsMax} ch.`;
}

function defaultPrice(value) {
  return `${new Intl.NumberFormat('fr-FR').format(value)}$`;
}

/**
 * Units of one building, ordered for the drawer: cheapest first, and a unit
 * with no price last rather than sorted as if it were free.
 */
export function orderedUnits(group) {
  return [...group.listings].sort((a, b) => {
    const pa = toNumber(a.price);
    const pb = toNumber(b.price);
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  });
}
