/**
 * How the price pages (/combien-coute) group and link to each other — pure,
 * client-safe, unit tested (tests/unit/price-guide-links.test.js).
 *
 * A guide is getPriceGuides' row: { commune, beds, listings, median, slug }.
 */

/**
 * Guides grouped by commune, the commune with the most listings first, each
 * group in bedroom order. Ties by name, so the page does not reshuffle.
 */
export function groupGuidesByCommune(guides) {
  const groups = new Map();
  for (const guide of guides || []) {
    const group = groups.get(guide.commune) || { commune: guide.commune, listings: 0, guides: [] };
    group.listings += Number(guide.listings) || 0;
    group.guides.push(guide);
    groups.set(guide.commune, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, guides: g.guides.slice().sort((a, b) => a.beds - b.beds) }))
    .sort((a, b) => b.listings - a.listings || String(a.commune).localeCompare(String(b.commune)));
}

/**
 * The `limit` guides for `beds` bedrooms resting on the most listings — the
 * figures the hub's search snippet quotes ("Limete 500 $, Gombe 1 500 $…").
 */
export function priceExamples(guides, beds, limit) {
  return (guides || [])
    .filter((g) => g.beds === beds)
    .sort((a, b) => b.listings - a.listings || String(a.commune).localeCompare(String(b.commune)))
    .slice(0, limit);
}

/**
 * The links under one price page: the other bedroom counts in its commune,
 * and the same bedroom count in the communes with the most listings — so
 * every price page is one hop from its neighbours, not only from the hub.
 */
export function relatedGuides(guides, guide, { sameBedsLimit = 6 } = {}) {
  const others = (guides || []).filter((g) => g.slug !== guide.slug);
  const sameCommune = others.filter((g) => g.commune === guide.commune).sort((a, b) => a.beds - b.beds);
  const sameBeds = others
    .filter((g) => g.beds === guide.beds && g.commune !== guide.commune)
    .sort((a, b) => b.listings - a.listings || String(a.commune).localeCompare(String(b.commune)))
    .slice(0, sameBedsLimit);
  return { sameCommune, sameBeds };
}
