import FilterBar from '@/components/FilterBar';
import ActiveFilterChips from '@/components/ActiveFilterChips';
import FloatingControlBar from '@/components/FloatingControlBar';
import ListingsSplitView from '@/components/ListingsSplitView';
import ResultsHeader from '@/components/ResultsHeader';
import ListingsEmptyState from '@/components/ListingsEmptyState';
import { getListings, getPopularCommunes, getCommuneShowcase, getPropertyTypeFacets, getPriceRange } from '@/lib/listings';
import { getLocationHierarchySafe } from '@/lib/locations';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { PROPERTY_TYPE_PLURALS } from '@/lib/constants';

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
    { total, count, data, locationRelaxed, relaxedFromCommune, requestedRadius, radiusExpanded, effectiveRadius },
    popularCommunes,
    showcase,
    { maxPrice },
  ] = await Promise.all([
    getLocationHierarchySafe(),
    getListings({ ...filters, limit, offset }),
    getPopularCommunes(),
    getCommuneShowcase(24),
    getPriceRange(),
  ]);
  const propertyTypes = await getPropertyTypeFacets();

  const { locations } = hierarchy;
  const communes = hierarchy.communes.length > 0 ? hierarchy.communes : showcase.map((c) => c.commune);

  const totalPages = Math.max(Math.ceil(total / limit), 1);
  const isMapView = params.view === 'map';
  const propertyTypeLabel = params.property_type
    ? PROPERTY_TYPE_PLURALS[params.property_type] ||
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
            quartier: params.quartier,
            radius: params.radius,
            propertyType: params.property_type,
            parcelleSubtype: params.parcelle_subtype,
            priceMin: params.price_min,
            priceMax: params.price_max,
            bedsMin: params.beds_min,
            bathMin: params.bath_min,
            depositMax: params.deposit_max,
            // Same comma-separated-string -> array parsing as lib/searchQuery.js's
            // parseListingsSearchParams (kept in step with it manually since this
            // object is FilterBar's *initial client state* seed, not the query
            // options passed to getListings()).
            amenities: params.amenities ? params.amenities.split(',').filter(Boolean) : [],
            search: params.q,
            sort: params.sort,
            view: params.view,
          }}
        />
      </div>

      <div className={isMapView ? 'hidden lg:block' : ''}>
        <ActiveFilterChips params={params} propertyTypeLabel={propertyTypeLabel} />
      </div>

      {/* pb-36 (144px), not pb-20: FloatingControlBar is `fixed bottom-
          [4.75rem]` (76px) with its own ~44px pill height, so its top edge
          sits ~120px above the viewport bottom — pb-20 (80px) left the last
          ~40px of the results grid genuinely hidden behind it, exactly
          where a mobile card's own action row lives. Measured directly
          against the real component, not guessed. lg:pb-8 is unchanged —
          FloatingControlBar is lg:hidden, so there is nothing to clear
          there. */}
      <div className="mx-auto max-w-[1600px] px-4 pb-36 pt-6 sm:px-6 lg:px-8 lg:pb-8">
        <div className={isMapView ? 'hidden lg:block' : ''}>
          <ResultsHeader
            total={total}
            commune={params.commune}
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
          />
        </div>

        {count === 0 ? (
          <ListingsEmptyState popularCommunes={popularCommunes} params={params} propertyTypeLabel={propertyTypeLabel} />
        ) : (
          <ListingsSplitView
            listings={data}
            isMapView={isMapView}
            page={page}
            totalPages={totalPages}
            params={params}
            popularCommunes={popularCommunes}
            communes={communes}
            total={total}
          />
        )}
      </div>

      {/* MobileMapChrome (inside ListingsSplitView's map wrapper) already
          owns the "back to list" action in map mode, at a different
          position and alongside real search/filter controls — rendering
          this too would duplicate it. */}
      {!isMapView ? <FloatingControlBar /> : null}
    </div>
  );
}
