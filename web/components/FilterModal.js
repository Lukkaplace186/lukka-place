'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { PillOption } from './FilterPill';
import AdvancedFilterFields from './AdvancedFilterFields';
import { useT } from '@/lib/i18n/client';
import { facetLabel, groupTypeFacets } from '@/lib/commercialSpaces';
import { LEASE_TERM_OPTIONS } from '@/lib/leaseTerm';
import { frNumber } from '@/lib/format';

/** The chips, in this order (owner decision 2026-10-22); every other type is in the dropdown. */
const PRIMARY_TYPE_VALUES = ['parcelle', 'appartement', 'maison', 'villa', 'terrain'];
const PRIMARY_TYPE_LABEL_KEYS = {
  parcelle: 'listings.filters.typeChip.parcelle',
  appartement: 'listings.filters.typeChip.appartement',
  maison: 'listings.filters.typeChip.maison',
  villa: 'listings.filters.typeChip.villa',
  terrain: 'listings.filters.typeChip.terrain',
};

const numberInputClass =
  'u-focus-ring w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-sm text-ink placeholder:text-ink-25';

function Section({ label, children }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-6 last:border-b-0 last:pb-0">
      <span className="text-[1rem] font-bold text-ink">{label}</span>
      {children}
    </div>
  );
}

/**
 * Mobile's single "Filtres" entry point — a full-screen Sheet replacing
 * the horizontal pill row (Chambres/Prix/Type de bien) and the separate
 * "Plus de filtres" trigger, both `lg:flex`/`lg:inline-flex`-only now (see
 * FilterBar.js). Rightmove/Zoopla's own mobile filter screens don't split
 * "primary" filters into pills and "everything else" into a second sheet —
 * one screen, everything in it.
 *
 * Prix / Chambres / Salles de bain / Type de bien get their own top-level
 * sections here (the four fields both the Rightmove-style and Zoopla-style
 * specs asked for explicitly, styled as large `size="lg"` pills where the
 * desktop pill-panel equivalent uses small ones — this sheet has the room).
 * Everything else FiltersDrawer.js already covers on desktop (Commune,
 * Quartier, Sous-type de parcelle, amenity groups, Conditions de paiement) is real,
 * working filter state too, not something to drop just because mobile's
 * top-level list didn't name it — AdvancedFilterFields.js is the same
 * shared component FiltersDrawer.js renders, with `includeBedsBaths={false}`
 * since Chambres/Salles de bain already have their own section above and
 * showing that pair twice on one screen would just be noise.
 *
 * No "Radius" section — that control was removed from search filters
 * entirely (see FilterBar.js's own note on `FILTER_PARAM_KEYS`).
 *
 * Fields write straight into FilterBar's state via `setters`, same as
 * FiltersDrawer.js — no per-tap navigation. FilterBar's existing debounced
 * `/api/listings/count` effect is what keeps `resultCountLabel` ("Voir N
 * résultats") live as fields change here, matching the reference
 * screenshots' own live-updating result count; only the bottom bar's
 * primary button actually navigates.
 */
export default function FilterModal({
  open,
  onClose,
  onApply,
  propertyTypes = [],
  locations,
  commune,
  priceSliderMax,
  values = {},
  setters = {},
  resultCountLabel,
  resultPending,
  showLeaseTerm = true,
}) {
  const t = useT();
  const {
    propertyType = '', priceMin = '', priceMax = '', bedsMin = '', bathMin = '',
    quartier = '', parcelleSubtype = '', depositRange = '', leaseTerm = '', amenities = [],
    plotMin = '', plotMax = '',
  } = values;
  const {
    setPropertyType, setPriceMin, setPriceMax, setBedsMin, setBathMin,
    setCommune, setQuartier, setParcelleSubtype, setDepositRange, setLeaseTerm, setAmenities,
    setPlotMin, setPlotMax,
  } = setters;

  const facetByValue = new Map(propertyTypes.map((facet) => [facet.value, facet]));
  const primaryTypes = PRIMARY_TYPE_VALUES.map((value) => ({ value, facet: facetByValue.get(value) || null }));
  const grouped = groupTypeFacets(propertyTypes.filter((facet) => !PRIMARY_TYPE_VALUES.includes(facet.value)));
  const otherTypes = { residential: grouped.residential, commercial: grouped.commercial };
  const otherSelected = Boolean(propertyType) && !PRIMARY_TYPE_VALUES.includes(propertyType);

  function reset() {
    setPropertyType?.('');
    setPriceMin?.('');
    setPriceMax?.('');
    setBedsMin?.('');
    setBathMin?.('');
    setCommune?.('');
    setQuartier?.('');
    setParcelleSubtype?.('');
    setDepositRange?.('');
    setLeaseTerm?.('');
    setAmenities?.([]);
    setPlotMin?.('');
    setPlotMax?.('');
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        // The base SheetContent primitive (components/ui/sheet.jsx) ships
        // `data-[side=bottom]:h-auto` unconditionally. That's an
        // attribute-selector rule ([data-side=bottom].h-auto), which beats a
        // plain `h-[100dvh]` utility on CSS specificity regardless of source
        // order — confirmed live: the sheet rendered at height:1487px with
        // its top edge at y:-526px, permanently off-screen, which is exactly
        // the "header and top filters missing" bug. Scoping the override
        // under the same `data-[side=bottom]:` modifier matches it on
        // specificity and lets tailwind-merge dedupe the conflicting rule,
        // so this sheet actually gets the full-height it asks for.
        className="flex flex-col gap-0 rounded-t-none border-line bg-surface p-0 data-[side=bottom]:h-[100dvh] sm:data-[side=bottom]:h-[92vh] sm:rounded-t-xl lg:hidden"
      >
        <SheetHeader className="border-b border-line">
          <SheetTitle className="font-display text-xl font-normal tracking-[-0.01em]">{t('listings.filters.title')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-10 pt-5">
          {showLeaseTerm ? (
            <Section label={t('listings.leaseTerm.label')}>
              <div className="flex flex-wrap gap-2">
                {LEASE_TERM_OPTIONS.map((option) => (
                  <PillOption key={option.value || 'any'} size="lg" selected={leaseTerm === option.value} onClick={() => setLeaseTerm?.(option.value)}>
                    {t(option.labelKey)}
                  </PillOption>
                ))}
              </div>
              <p className="text-xs text-ink-45">{t('listings.leaseTerm.hint')}</p>
            </Section>
          ) : null}

          <Section label={t('listings.filters.priceUsdSection')}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={priceMin}
                onChange={(e) => setPriceMin?.(e.target.value)}
                placeholder={t('listings.filters.min')}
                aria-label={t('listings.filters.priceMin')}
                className={numberInputClass}
              />
              <span className="text-ink-25">-</span>
              <input
                type="number"
                min="0"
                value={priceMax}
                onChange={(e) => setPriceMax?.(e.target.value)}
                placeholder={t('listings.filters.max')}
                aria-label={t('listings.filters.priceMax')}
                className={numberInputClass}
              />
            </div>
            <p className="text-xs text-ink-45">Jusqu&rsquo;à {frNumber(priceSliderMax)} $ dans le catalogue actuel.</p>
          </Section>

          <Section label={t('listings.filters.bedrooms')}>
            <div className="flex flex-wrap gap-2">
              <PillOption size="lg" selected={!bedsMin} onClick={() => setBedsMin?.('')}>
                {t('listings.filters.any')}
              </PillOption>
              {[1, 2, 3, 4, 5].map((n) => (
                <PillOption key={n} size="lg" selected={String(bedsMin) === String(n)} onClick={() => setBedsMin?.(String(n))}>
                  {n}+
                </PillOption>
              ))}
            </div>
          </Section>

          <Section label={t('listings.filters.bathrooms')}>
            <div className="flex flex-wrap gap-2">
              <PillOption size="lg" selected={!bathMin} onClick={() => setBathMin?.('')}>
                {t('listings.filters.any')}
              </PillOption>
              {[1, 2, 3, 4].map((n) => (
                <PillOption key={n} size="lg" selected={String(bathMin) === String(n)} onClick={() => setBathMin?.(String(n))}>
                  {n}+
                </PillOption>
              ))}
            </div>
          </Section>

          <Section label={t('listings.filters.propertyType')}>
            <div className="flex flex-wrap gap-2">
              <PillOption size="lg" selected={!propertyType} onClick={() => setPropertyType?.('')}>
                {t('listings.filters.allTypes')}
              </PillOption>
              {/* The five kinds people search for most, always in this
                  order, each with its real count (getPropertyTypeFacets —
                  Villa includes the villas filed under Maison). A kind with
                  no listing right now is shown greyed out rather than
                  leading to an empty page. */}
              {primaryTypes.map(({ value, facet }) => (
                <PillOption
                  key={value}
                  size="lg"
                  selected={propertyType === value}
                  disabled={!facet}
                  aria-disabled={!facet}
                  className={!facet ? 'pointer-events-none opacity-40' : undefined}
                  onClick={() => setPropertyType?.(value)}
                >
                  {facet ? facetLabel(facet, t) : t(PRIMARY_TYPE_LABEL_KEYS[value])}
                  <span className="u-tabular ml-1.5 opacity-60">{facet ? facet.count : 0}</span>
                </PillOption>
              ))}
            </div>
            {/* Every other kind with listings (Duplex, Studio, Bureau…), one
                dropdown, so none of them becomes unreachable. */}
            {otherTypes.residential.length || otherTypes.commercial.length ? (
              <label className="mt-3 block">
                <span className="mb-1.5 block text-xs font-medium text-ink-70">{t('listings.filters.otherTypes')}</span>
                <select
                  value={otherSelected ? propertyType : ''}
                  onChange={(e) => setPropertyType?.(e.target.value)}
                  className={`u-focus-ring w-full rounded-lg border bg-surface px-3 py-3 text-[0.9375rem] ${otherSelected ? 'border-blue text-blue-deep' : 'border-line text-ink'}`}
                >
                  <option value="">{t('listings.filters.otherTypesPlaceholder')}</option>
                  {otherTypes.residential.length ? (
                    <optgroup label={t('listings.commercial.group.residential')}>
                      {otherTypes.residential.map((facet) => (
                        <option key={facet.value} value={facet.value}>{facetLabel(facet, t)} ({facet.count})</option>
                      ))}
                    </optgroup>
                  ) : null}
                  {otherTypes.commercial.length ? (
                    <optgroup label={t('listings.commercial.group.commercial')}>
                      {otherTypes.commercial.map((facet) => (
                        <option key={facet.value} value={facet.value}>{facetLabel(facet, t)} ({facet.count})</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
            ) : null}
          </Section>

          <AdvancedFilterFields
            locations={locations}
            commune={commune}
            propertyType={propertyType}
            values={{ quartier, parcelleSubtype, depositRange, amenities, plotMin, plotMax }}
            setters={{ setCommune, setQuartier, setParcelleSubtype, setDepositRange, setAmenities, setPlotMin, setPlotMax }}
            includeBedsBaths={false}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={reset}
            className="u-press u-btn-secondary flex-1 rounded-full py-2.5 text-center text-sm font-semibold text-ink"
          >
            {t('listings.filters.clearAll')}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApply?.();
            }}
            className={`u-press flex-1 rounded-full bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary ${resultPending ? 'opacity-70' : ''}`}
          >
            {resultCountLabel || t('listings.filters.viewResultsGeneric')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
