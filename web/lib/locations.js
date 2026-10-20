import 'server-only';

/**
 * Fetches the Kinshasa commune -> quartier hierarchy from the engine's own
 * GET /locations (lukka-place-engine/index.js) — server-side only, so this
 * never becomes a browser-to-different-origin request and needs no CORS
 * configuration on the engine at all. The result is handed down as a prop to
 * a Client Component, which does all cascading commune/quartier logic
 * in-memory from there — one fetch total, no further network calls as the
 * user interacts with the selects.
 *
 * Not wrapped in a Next.js cache directive for now (this version's `fetch`
 * caching model differs from what a similarly-purposed call would have used
 * on Next 13/14 — see AGENTS.md) — the payload is small and the engine is
 * fast, so an uncached fetch per request is simplest and correct. Revisit
 * with the `'use cache'` directive if this becomes a hot path.
 *
 * `city` (2026-10-20): omitted = Kinshasa, exactly as before; a city name for
 * that city; 'all' for every city's communes, Kinshasa first — what agent and
 * admin forms list, grouped by city (components/CommuneOptions.js).
 *
 * @param {{city?: string}} [options]
 * @returns {Promise<{communes: string[], locations: Record<string, string[]>}>}
 */
export async function getLocationHierarchy({ city = null } = {}) {
  const base = process.env.ENGINE_API_BASE;
  if (!base) {
    throw new Error('ENGINE_API_BASE is not set — see .env.local');
  }

  const res = await fetch(`${base}/locations${city ? `?city=${encodeURIComponent(city)}` : ''}`);
  if (!res.ok) {
    throw new Error(`GET ${base}/locations failed: ${res.status}`);
  }

  const body = await res.json();
  return { communes: body.communes, locations: body.locations };
}

/**
 * Non-throwing variant for surfaces that must render even when the engine is
 * unreachable.
 *
 * /listings previously hard-depended on this fetch: the listings themselves
 * come from Postgres and were fine, but a single unreachable engine took the
 * whole page down with a 500 — confirmed locally, where the engine is not
 * running (ECONNREFUSED). The commune/quartier hierarchy only feeds the
 * filter bar, so losing it should degrade the filters, not the results.
 *
 * Callers get `{ communes: [], locations: {} }` on failure and are expected
 * to substitute communes they can derive from the database instead. The
 * quartier filter genuinely cannot work without this data, and FiltersDrawer
 * already disables it when no quartiers are available.
 *
 * @returns {Promise<{communes: string[], locations: Record<string, string[]>, degraded: boolean}>}
 */
export async function getLocationHierarchySafe(options = {}) {
  try {
    const result = await getLocationHierarchy(options);
    return { ...result, degraded: false };
  } catch (error) {
    console.warn('[locations] falling back to database-derived communes:', error.message);
    return { communes: [], locations: {}, degraded: true };
  }
}

/**
 * The hierarchy, with the database-derived fallback already applied.
 *
 * getLocationHierarchySafe() only promises not to throw — substituting real
 * communes when it degrades was left to each caller, and only one of the two
 * callers actually did it. /listings falls back correctly; the agent
 * create-listing form did not, and its empty list became the allow-list that
 * createListingAction validates the submitted commune against
 * (`if (!new Set(validCommunes).has(commune))`). With the engine down, the
 * commune select rendered empty AND every submission was rejected as
 * "Commune invalide" — an unrelated process on another port silently made it
 * impossible for an agent to list a property.
 *
 * Doing the substitution here rather than at each call site means a third
 * caller cannot reintroduce the same gap.
 *
 * The fallback communes come from listings that actually exist, so a commune
 * with no listings won't appear during an outage — honest, and still enough
 * to write a listing against.
 *
 * @returns {Promise<{communes: string[], locations: Record<string, string[]>, degraded: boolean}>}
 */
export async function getLocationHierarchyWithFallback(options = {}) {
  const hierarchy = await getLocationHierarchySafe(options);
  if (hierarchy.communes.length > 0) return hierarchy;

  // Every city's communes: the list is static data shipped with the app
  // (lib/cities.js), so an engine outage loses the quartiers, not the
  // communes — and never a whole city.
  if (options.city === 'all') {
    const { CITIES } = await import('./cities');
    return { ...hierarchy, communes: CITIES.flatMap((c) => c.communes.map((x) => x.key)) };
  }

  // Imported lazily so the happy path never pulls in the database module.
  const { getCommuneShowcase } = await import('./listings');
  const showcase = await getCommuneShowcase(24);
  return { ...hierarchy, communes: showcase.map((c) => c.commune).filter(Boolean) };
}
