'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { PillOption } from './FilterPill';
import AdvancedFilterFields from './AdvancedFilterFields';

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
 * Everything else FiltersDrawer.js already covers on desktop (Quartier,
 * Sous-type de parcelle, amenity groups, Conditions de location) is real,
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
  quartiers,
  commune,
  priceSliderMax,
  values = {},
  setters = {},
  resultCountLabel,
  resultPending,
}) {
  const {
    propertyType = '', priceMin = '', priceMax = '', bedsMin = '', bathMin = '',
    quartier = '', parcelleSubtype = '', depositMax = '', amenities = [],
  } = values;
  const {
    setPropertyType, setPriceMin, setPriceMax, setBedsMin, setBathMin,
    setQuartier, setParcelleSubtype, setDepositMax, setAmenities,
  } = setters;

  function reset() {
    setPropertyType?.('');
    setPriceMin?.('');
    setPriceMax?.('');
    setBedsMin?.('');
    setBathMin?.('');
    setQuartier?.('');
    setParcelleSubtype?.('');
    setDepositMax?.('');
    setAmenities?.([]);
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        className="flex h-[100dvh] flex-col gap-0 rounded-t-none border-line bg-surface p-0 sm:h-[92vh] sm:rounded-t-xl lg:hidden"
      >
        <SheetHeader className="border-b border-line">
          <SheetTitle className="font-display text-xl font-normal tracking-[-0.01em]">Filtres</SheetTitle>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5">
          <Section label="Prix (USD)">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={priceMin}
                onChange={(e) => setPriceMin?.(e.target.value)}
                placeholder="Min"
                aria-label="Prix minimum"
                className={numberInputClass}
              />
              <span className="text-ink-25">-</span>
              <input
                type="number"
                min="0"
                value={priceMax}
                onChange={(e) => setPriceMax?.(e.target.value)}
                placeholder="Max"
                aria-label="Prix maximum"
                className={numberInputClass}
              />
            </div>
            <p className="text-xs text-ink-45">Jusqu&rsquo;à {priceSliderMax.toLocaleString('fr-FR')} $ dans le catalogue actuel.</p>
          </Section>

          <Section label="Chambres">
            <div className="flex flex-wrap gap-2">
              <PillOption size="lg" selected={!bedsMin} onClick={() => setBedsMin?.('')}>
                Toutes
              </PillOption>
              {[1, 2, 3, 4, 5].map((n) => (
                <PillOption key={n} size="lg" selected={String(bedsMin) === String(n)} onClick={() => setBedsMin?.(String(n))}>
                  {n}+
                </PillOption>
              ))}
            </div>
          </Section>

          <Section label="Salles de bain">
            <div className="flex flex-wrap gap-2">
              <PillOption size="lg" selected={!bathMin} onClick={() => setBathMin?.('')}>
                Toutes
              </PillOption>
              {[1, 2, 3, 4].map((n) => (
                <PillOption key={n} size="lg" selected={String(bathMin) === String(n)} onClick={() => setBathMin?.(String(n))}>
                  {n}+
                </PillOption>
              ))}
            </div>
          </Section>

          <Section label="Type de bien">
            <div className="flex flex-wrap gap-2">
              <PillOption size="lg" selected={!propertyType} onClick={() => setPropertyType?.('')}>
                Tous
              </PillOption>
              {/* DB-derived, with real counts — same source FilterBar's
                  desktop pill uses, so a type that would return zero
                  results is never offered here either. */}
              {propertyTypes.map(({ value, label, count }) => (
                <PillOption key={value} size="lg" selected={propertyType === value} onClick={() => setPropertyType?.(value)}>
                  {label}
                  <span className="u-tabular ml-1.5 opacity-60">{count}</span>
                </PillOption>
              ))}
            </div>
          </Section>

          <AdvancedFilterFields
            quartiers={quartiers}
            commune={commune}
            propertyType={propertyType}
            values={{ quartier, parcelleSubtype, depositMax, amenities }}
            setters={{ setQuartier, setParcelleSubtype, setDepositMax, setAmenities }}
            includeBedsBaths={false}
          />
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={reset}
            className="u-press u-btn-secondary flex-1 rounded-full py-2.5 text-center text-sm font-semibold text-ink"
          >
            Tout effacer
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApply?.();
            }}
            className={`u-press flex-1 rounded-full bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary ${resultPending ? 'opacity-70' : ''}`}
          >
            {resultCountLabel || 'Voir les résultats'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
