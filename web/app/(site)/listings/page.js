import FilterBar from '@/components/FilterBar';
import ActiveFilterChips from '@/components/ActiveFilterChips';
import ListingsSplitView from '@/components/ListingsSplitView';
import ResultsHeader from '@/components/ResultsHeader';
import ListingsEmptyState from '@/components/ListingsEmptyState';
import FloatingControlBar from '@/components/FloatingControlBar';
import { getListings, getNearbyExtras, THIN_RESULTS_MAX } from '@/lib/listings';
import {
  cachedCommuneShowcase,
  cachedPopularCommunes,
  cachedPriceRange,
  cachedPropertyTypeFacets,
} from '@/lib/listingsCached';
import { getLocationHierarchySafe } from '@/lib/locations';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { PROPERTY_TYPE_PLURAL_KEYS } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { MAP_BOUNDS_PARAMS } from '@/lib/mapViewport';
import { hrefWithoutKeys } from '@/lib/urlParams';
import { distanceKm } from '@/lib/mapViewport';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { seoPathForParams } from '@/lib/seoPages';

/** Filters worth logging as "a search" (sort/view/page are not). */
const SEARCH_LOG_KEYS = [
  'transaction_type', 'commune', 'communes', 'quartier', 'radius', 'property_type', 'parcelle_subtype',
  'price_min', 'price_max', 'beds_min', 'bath_min', 'deposit_max', 'deposit_range', 'amenities', 'q', 'reference',
];

/**
 * Communes that have listings, nearest to the one searched first, each with
 * its distance — the empty state's escape routes. Distances are between real
 * geocoded commune centres (KINSHASA_COMMUNE_CENTROIDS), rounded, never below
 * 1 km. Without a searched commune, the busiest communes as before.
 */
function communesByDistance(allCommunes, from, limit = 6) {
  const origin = from ? KINSHASA_COMMUNE_CENTROIDS[from] : null;
  if (!origin) return allCommunes.slice(0, limit);
  return allCommunes
    .filter(({ commune }) => commune !== from && KINSHASA_COMMUNE_CENTROIDS[commune])
    .map((row) => ({ ...row, km: Math.max(1, Math.round(distanceKm(origin, KINSHASA_COMMUNE_CENTROIDS[row.commune]))) }))
    .sort((a, b) => a.km - b.km || b.count - a.count)
    .slice(0, limit);
}

/**
 * Search results are a tool, not a page Google should rank on its own: a
 * filter combination that a landing page already covers
 * (?transaction_type=location&commune=Gombe) names that page as canonical;
 * the bare /listings is indexable; anything narrower (budget, quartier, map
 * box, page 2) is noindex but followed, so its listing links still count.
 * lib/seoPages.js seoPathForParams.
 */
export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const t = await getT();
  const landing = seoPathForParams(params);
  const hasFilters = Object.entries(params).some(([k, v]) => v && !['sort', 'view'].includes(k) && !k.startsWith('utm_'));
  return {
    title: `${t('breadcrumb.listings')} — ${t('site.metaTitle')}`,
    alternates: { canonical: landing || '/listings' },
    robots: !hasFilters || landing ? undefined : { index: false, follow: true },
  };
}

export default async function ListingsPage({ searchParams }) {
  const params = await searchParams;

  const page = Math.max(Number.parseInt(params.page, 10) || 1, 1);
  const limit = 12;
  const offset = (page - 1) * limit;

  const filters = { ...parseListingsSearchParams(params), sort: params.sort };

  // The hierarchy comes from the engine and only feeds the filter bar, so a
  // failure there degrades the filters rather than 500-ing a page whose
  // actual results come from Postgres. Communes then fall back to the ones
  // the database can prove have approved listings.
  const [
    hierarchy,
    { total, count, data, locationRelaxed, relaxedFromCommune, requestedRadius, radiusExpanded, effectiveRadius, mapArea, relaxation },
    communeCounts,
    showcase,
    { maxPrice },
  ] = await Promise.all([
    getLocationHierarchySafe(),
    // allowRelax: an empty exact search falls back to the closest real
    // alternatives, each step named in `relaxation` (lib/listings.js
    // relaxSearch) and shown by ResultsHeader.
    getListings({ ...filters, limit, offset, allowRelax: true }),
    // Counts, showcase and price ceiling: 60-second copies. The results
    // above are always live.
    cachedPopularCommunes(24),
    cachedCommuneShowcase(24),
    cachedPriceRange(),
  ]);
  const propertyTypes = await cachedPropertyTypeFacets();

  // A place search with only one or two exact results also shows the nearest
  // others beneath them (lib/listings.js getNearbyExtras). Not on the map
  // area, not on later pages, not when the results are already a fallback.
  const nearbyExtras =
    page === 1 && !mapArea && !relaxation && total > 0 && total <= THIN_RESULTS_MAX && filters.commune
      ? await getNearbyExtras(filters, data.map((l) => l.id)).catch((err) => {
          console.error(`[listings] nearby extras unavailable: ${err.message}`);
          return null;
        })
      : null;

  const popularCommunes = communeCounts.slice(0, 6);
  const nearbyCommunes = communesByDistance(communeCounts, params.commune);

  // One line per search in the web process log — what people look for and
  // which searches come back empty. Structured filters only (what the URL
  // carries), no visitor identifier. Read with
  // `pm2 logs lukka-place-web --lines 5000 --nostream | grep '\[search\]'`.
  if (page === 1 && !mapArea && SEARCH_LOG_KEYS.some((key) => params[key])) {
    const logged = {};
    for (const key of SEARCH_LOG_KEYS) if (params[key]) logged[key] = String(params[key]).slice(0, 120);
    console.log(
      `[search] ${JSON.stringify({
        ...logged,
        total,
        exact: !relaxation && !locationRelaxed && !radiusExpanded,
        relaxed: relaxation ? Object.keys(relaxation) : undefined,
      })}`,
    );
  }

  const { locations } = hierarchy;
  const communes = hierarchy.communes.length > 0 ? hierarchy.communes : showcase.map((c) => c.commune);

  const totalPages = Math.max(Math.ceil(total / limit), 1);
  // The results are the map's visible area (the visitor moved the map). The
  // location filters are still in the URL — clearing the area returns to them.
  const clearAreaHref = mapArea ? hrefWithoutKeys(params, [...MAP_BOUNDS_PARAMS, 'page']) : null;
  const isMapView = params.view === 'map';
  // The plural form is dictionary copy ("Appartements" / "Apartments"); the
  // facet fallback is a real category name out of the database, so it is used
  // verbatim in either language.
  const t = await getT();
  const pluralKey = params.property_type ? PROPERTY_TYPE_PLURAL_KEYS[params.property_type] : undefined;
  const propertyTypeLabel = params.property_type
    ? (pluralKey ? t(pluralKey) : undefined) ||
      propertyTypes.find((o) => o.value === params.property_type)?.label
    : undefined;

  return (
    <div>
      {/* Hidden on mobile once the immersive fullscreen map takes over
          (see ListingsSplitView's map wrapper) — FilterBar sticks at z-40,
          above the map's z-30, so left visible it would float on top of
          the map rather than being replaced by it. MobileMapChrome carries
          its own compact search/filter trigger for that mode instead.
          Desktop is unaffected: the split view always shows both panes
          there regardless of isMapView. */}
      <div className={isMapView ? 'hidden lg:block' : ''}>
        <FilterBar
          locations={locations}
          propertyTypes={propertyTypes}
          initialTotal={total}
          priceCeiling={maxPrice}
          defaults={{
            transactionType: params.transaction_type,
            commune: params.commune,
            communes: params.communes,
            quartier: params.quartier,
            radius: params.radius,
            propertyType: params.property_type,
            parcelleSubtype: params.parcelle_subtype,
            priceMin: params.price_min,
            priceMax: params.price_max,
            bedsMin: params.beds_min,
            bathMin: params.bath_min,
            depositMax: params.deposit_max,
            depositRange: params.deposit_range,
            // Same comma-separated-string -> array parsing as lib/searchQuery.js's
            // parseListingsSearchParams (kept in step with it manually since this
            // object is FilterBar's *initial client state* seed, not the query
            // options passed to getListings()).
            amenities: params.amenities ? params.amenities.split(',').filter(Boolean) : [],
            search: params.q,
            near: params.near,
            sort: params.sort,
            view: params.view,
          }}
        />
      </div>

      {/* hidden lg:block, unconditionally now — this used to be visible on
          mobile in list view (only map view hid it there), per an explicit
          "no chip row above the mobile feed, active filters live in
          FilterModal only" instruction. Desktop is unaffected: it always
          showed this regardless of isMapView, and still does. */}
      <div className="hidden lg:block">
        <ActiveFilterChips params={params} propertyTypeLabel={propertyTypeLabel} />
      </div>

      {/* pb-28 below lg clears FloatingControlBar, which floats over the
          last card and the pagination on a phone. pt-3 keeps the first card
          close to the top of the screen; desktop keeps its own spacing. */}
      <div className="mx-auto max-w-[1600px] px-4 pb-28 pt-3 sm:px-6 sm:pt-6 lg:px-8 lg:pb-8">
        <div className={isMapView ? 'hidden lg:block' : ''}>
          <ResultsHeader
            total={total}
            commune={params.commune}
            communes={filters.communes}
            quartier={params.quartier}
            transactionType={params.transaction_type}
            propertyTypeLabel={propertyTypeLabel}
            locationRelaxed={locationRelaxed}
            relaxedFromCommune={relaxedFromCommune}
            citywide={params.radius === 'citywide'}
            communeWide={params.radius === 'commune'}
            radiusExpanded={radiusExpanded}
            requestedRadius={requestedRadius}
            effectiveRadius={effectiveRadius}
            mapArea={Boolean(mapArea)}
            clearAreaHref={clearAreaHref}
            relaxation={relaxation}
          />
        </div>

        {/* An empty map area keeps the split view: the map is how the visitor
            gets out of it, and the full empty state would take it away. */}
        {count === 0 && !mapArea ? (
          <ListingsEmptyState popularCommunes={nearbyCommunes} params={params} propertyTypeLabel={propertyTypeLabel} />
        ) : (
          <ListingsSplitView
            listings={data}
            isMapView={isMapView}
            page={page}
            totalPages={totalPages}
            params={params}
            popularCommunes={popularCommunes}
            communes={communes}
            clearAreaHref={clearAreaHref}
            nearby={nearbyExtras ? { ...nearbyExtras, place: params.commune } : null}
          />
        )}
      </div>

      {/* List mode only — the mobile fullscreen map already has its own
          bottom-center floating control at this exact position
          (MobileMapOverlay.js's "← Liste" button). Rendered on an empty
          search too: its alert is the phone's only way to ask for one. */}
      {!isMapView ? <FloatingControlBar hasResults={count > 0} /> : null}
    </div>
  );
}
