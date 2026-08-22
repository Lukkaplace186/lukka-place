import Price from './Price';

/**
 * Specification table.
 *
 * Editorial hairline rows rather than a boxed grid of cards — the point is a
 * scannable list of facts, and a border around each fact adds noise without
 * adding structure.
 *
 * The rental-income row shows a `rent` listing's own price as its monthly
 * income and nothing at all for a `sale` listing: no market-comparable
 * dataset exists to estimate a yield, and inventing one would be exactly the
 * kind of fabricated figure CLAUDE.md rules out.
 *
 * Prices render through <Price> so they follow the visitor's USD/CDF
 * preference. No `purpose` is passed — this table labels each row explicitly
 * ("Prix", "Prix / m²"), so it wants the plain amount, not Price's own
 * "/ mois" suffix.
 */
export default function PropertyMetrics({ listing }) {
  const {
    price, purpose, area, beds, bath, quartier, commune,
    units_count: unitsCount, category_name: categoryName, deposit_months: depositMonths,
  } = listing;

  // `area` is a TEXT column carrying '0' rather than NULL when unknown, so a
  // naive render produces "0 m²" for a listing nobody measured.
  const numericArea = Number.parseFloat(area);
  const hasArea = Number.isFinite(numericArea) && numericArea > 0;
  const pricePerSqm = hasArea ? price / numericArea : null;

  const items = [
    { label: 'Prix', value: <Price amount={price} /> },
    categoryName ? { label: 'Type', value: <span className="capitalize">{categoryName}</span> } : null,
    hasArea ? { label: 'Superficie', value: `${area} m²` } : null,
    pricePerSqm ? { label: 'Prix / m²', value: <Price amount={Math.round(pricePerSqm)} /> } : null,
    beds != null ? { label: 'Chambres', value: beds } : null,
    bath != null ? { label: 'Salles de bain', value: bath } : null,
    unitsCount != null ? { label: 'Portes', value: unitsCount } : null,
    commune ? { label: 'Commune', value: commune } : null,
    quartier ? { label: 'Quartier', value: quartier } : null,
    // Real captured intake data, never a fabricated default term — absent on
    // every listing until the deposit_months column exists on live Supabase
    // (see the TODO in lib/listings.js).
    depositMonths != null ? { label: 'Garantie', value: `${depositMonths} mois` } : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {purpose === 'rent' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green/30 bg-green-tint px-5 py-4">
          <span className="text-[0.8125rem] font-semibold text-green-deep">Revenu locatif mensuel</span>
          <Price amount={price} className="u-tabular text-xl font-bold text-green-deep" />
        </div>
      ) : null}

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
        {items.map(({ label, value }) => (
          <div key={label} className="flex items-baseline justify-between gap-4 bg-surface px-5 py-3.5">
            <dt className="u-eyebrow">{label}</dt>
            <dd className="u-tabular text-[0.9375rem] font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
