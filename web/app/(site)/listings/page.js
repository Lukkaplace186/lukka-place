import FilterBar from '@/components/FilterBar';
import FloatingControlBar from '@/components/FloatingControlBar';
import ListingsSplitView from '@/components/ListingsSplitView';
import ResultsHeader from '@/components/ResultsHeader';
import ListingsEmptyState from '@/components/ListingsEmptyState';
import { getListings, getPopularCommunes, getCommuneShowcase, getPropertyTypeFacets } from '@/lib/listings';
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
  const [hierarchy, { total, count, data, locationRelaxed, relaxedFromCommune }, popularCommunes, showcase] = await Promise.all([
    getLocationHierarchySafe(),
    getListings({ ...filters, limit, offset }),
    getPopularCommunes(),
    getCommuneShowcase(24),
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
      <FilterBar
        communes={communes}
        locations={locations}
        propertyTypes={propertyTypes}
        initialTotal={total}
        defaults={{
          transactionType: params.transaction_type,
          commune: params.commune,
          quartier: params.quartier,
          propertyType: params.property_type,
          parcelleSubtype: params.parcelle_subtype,
          priceMin: params.price_min,
          priceMax: params.price_max,
          bedsMin: params.beds_min,
          bathMin: params.bath_min,
          areaMin: params.area_min,
          search: params.q,
          sort: params.sort,
          view: params.view,
        }}
      />

      {/* pb-36 (144px), not pb-20: FloatingControlBar is `fixed bottom-
          [4.75rem]` (76px) with its own ~44px pill height, so its top edge
          sits ~120px above the viewport bottom — pb-20 (80px) left the last
          ~40px of the results grid genuinely hidden behind it, exactly
          where a mobile card's own action row lives. Measured directly
          against the real component, not guessed. lg:pb-8 is unchanged —
          FloatingControlBar is lg:hidden, so there is nothing to clear
          there. */}
      <div className="mx-auto max-w-[1600px] px-4 pb-36 pt-6 sm:px-6 lg:px-8 lg:pb-8">
        <ResultsHeader
          total={total}
          commune={params.commune}
          quartier={params.quartier}
          transactionType={params.transaction_type}
          propertyTypeLabel={propertyTypeLabel}
          locationRelaxed={locationRelaxed}
          relaxedFromCommune={relaxedFromCommune}
        />

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
          />
        )}
      </div>

      <FloatingControlBar />
    </div>
  );
}
