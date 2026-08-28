import FilterBar from '@/components/FilterBar';
import ActiveFilterChips from '@/components/ActiveFilterChips';
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

      {/* hidden lg:block, unconditionally now — this used to be visible on
          mobile in list view (only map view hid it there), per an explicit
          "no chip row above the mobile feed, active filters live in
          FilterModal only" instruction. Desktop is unaffected: it always
          showed this regardless of isMapView, and still does. */}
      <div className="hidden lg:block">
        <ActiveFilterChips params={params} propertyTypeLabel={propertyTypeLabel} />
      </div>

      {/* pb-8 uniformly now — FloatingControlBar.js (the floating "Carte /
          Trier" pill this used to reserve extra mobile bottom clearance
          for) is gone entirely: removed on an explicit instruction, with
          "Carte" already reachable from FilterBar's own mobile utility row
          and "Trier" moved into ResultsHeader.js next to the result count
          (visible on every breakpoint now, not just lg: and up — see that
          component). Nothing floats over the last card any more, so
          there's nothing left to clear.
          pt-3, not the previous pt-6, below sm: with the breadcrumb and
          filter chips both hidden on mobile now (see above and
          ResultsHeader.js), this is the last real gap left between the
          utility row above and the first card — tightened so that card's
          top edge lands closer to the initial viewport, per the "tight,
          cohesive top block, no dead space" instruction. sm:pt-6 keeps
          desktop's original spacing, which isn't under the same
          above-the-fold pressure a phone screen is. */}
      <div className="mx-auto max-w-[1600px] px-4 pb-8 pt-3 sm:px-6 sm:pt-6 lg:px-8">
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

    </div>
  );
}
