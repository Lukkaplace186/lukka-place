'use client';

import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import FilterPill, { PillFieldLabel, PillOption } from './FilterPill';
import FiltersDrawer from './FiltersDrawer';
import LocationAutocomplete from './LocationAutocomplete';
import { Slider } from './ui/slider';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const FORM_ID = 'listings-filter-form';
const ADVANCED_KEYS = ['quartier', 'parcelleSubtype', 'bathMin', 'areaMin'];
// A fixed UI ceiling for the budget slider, not a claim about real listing
// extremes — there's no live min/max-price aggregate query today. Typing a
// higher value into the Max input still filters correctly; the slider just
// visually caps at this range.
const PRICE_SLIDER_MAX = 500000;

const numberInputClass =
  'w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-25 focus:border-blue focus:outline-none';

/**
 * Sticky search bar for /listings — the dense reference surface.
 *
 * Every filter value lives in React state here and is submitted through
 * hidden inputs rendered inside the form. That is deliberate: the pill
 * panels and the "Plus de filtres" sheet both render through Radix portals
 * to document.body, so any field nested inside them would sit outside the
 * form element and never be submitted. Owning the state here means the
 * panels are pure UI and there is exactly one place a filter value can come
 * from.
 *
 * `sort` and `view` are carried through as hidden inputs too — previously,
 * changing any filter silently discarded the visitor's sort order and
 * map/list choice, because the form never included them. `page` is
 * deliberately not carried, so changing a filter returns to page 1.
 *
 * Sticks at top-16 to sit directly under the fixed h-16 Header.
 */
export default function FilterBar({ communes, locations, propertyTypes = [], initialTotal, defaults = {} }) {
  const formRef = useRef(null);

  const [transaction, setTransaction] = useState(defaults.transactionType || '');
  const [commune, setCommune] = useState(defaults.commune || '');
  const [quartier, setQuartier] = useState(defaults.quartier || '');
  const [propertyType, setPropertyType] = useState(defaults.propertyType || '');
  const [parcelleSubtype, setParcelleSubtype] = useState(defaults.parcelleSubtype || '');
  const [bedsMin, setBedsMin] = useState(defaults.bedsMin || '');
  const [bathMin, setBathMin] = useState(defaults.bathMin || '');
  const [areaMin, setAreaMin] = useState(defaults.areaMin || '');
  const [priceMin, setPriceMin] = useState(defaults.priceMin || '');
  const [priceMax, setPriceMax] = useState(defaults.priceMax || '');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Live "Voir N biens" count for the Prix popover's and the "Plus de
  // filtres" drawer's CTA buttons — both stage several field changes before
  // one real submit, so a visitor benefits from seeing the real result
  // count update as they adjust, not just after committing. Seeded from the
  // page's own already-known `total` (the current URL's real result count)
  // rather than starting unknown, so there's no wasted first fetch and no
  // flash of a generic label on mount. `resultPending` drives a subtle
  // opacity dip on the CTA while a fetch is in flight — the count itself
  // never blanks mid-fetch, it just holds the last real value.
  const [resultCount, setResultCount] = useState(initialTotal);
  const [resultPending, setResultPending] = useState(false);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return undefined;
    }

    const controller = new AbortController();
    setResultPending(true);

    const timer = setTimeout(() => {
      const qs = new URLSearchParams();
      if (transaction) qs.set('transaction_type', transaction);
      if (commune) qs.set('commune', commune);
      if (quartier) qs.set('quartier', quartier);
      if (propertyType) qs.set('property_type', propertyType);
      if (propertyType === 'parcelle' && parcelleSubtype) qs.set('parcelle_subtype', parcelleSubtype);
      if (bedsMin) qs.set('beds_min', bedsMin);
      if (bathMin) qs.set('bath_min', bathMin);
      if (areaMin) qs.set('area_min', areaMin);
      if (priceMin) qs.set('price_min', priceMin);
      if (priceMax) qs.set('price_max', priceMax);

      fetch(`/api/listings/count?${qs.toString()}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((json) => {
          setResultCount(json.total);
          setResultPending(false);
        })
        .catch(() => {
          // Aborted (a newer change superseded this request) or a real
          // network error — either way, keep showing the last known real
          // count rather than blanking the button to something fabricated.
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setResultPending(false);
    };
  }, [transaction, commune, quartier, propertyType, parcelleSubtype, bedsMin, bathMin, areaMin, priceMin, priceMax]);

  const resultCountLabel =
    resultCount == null ? null : `Voir ${resultCount.toLocaleString('fr-FR')} bien${resultCount === 1 ? '' : 's'}`;

  const quartiers = commune ? locations[commune] || [] : [];
  const advancedCount = ADVANCED_KEYS.filter((key) => defaults[key]).length;

  function submit() {
    formRef.current?.requestSubmit();
  }

  // Set a value, then submit once React has committed it — the hidden
  // inputs read from state, so submitting synchronously would send the
  // previous value.
  function apply(setter) {
    return (value) => {
      setter(value);
      queueMicrotask(submit);
    };
  }

  const hidden = [
    // Carries the current free-text search forward across every other pill
    // action. LocationAutocomplete's own box does its own client-side
    // navigation for *changing* `q` (see the comment on it below), but this
    // form's requestSubmit() (every price/beds/type/commune pill) only
    // submits the named fields listed here — `q` was missing, so toggling
    // any other pill silently dropped whatever the visitor had typed.
    // Confirmed live: `?q=appartement&price_max=2000` -> click "Louer" ->
    // `?transaction_type=location&price_max=2000`, `q` gone.
    ['q', defaults.search || ''],
    ['transaction_type', transaction],
    ['commune', commune],
    ['quartier', quartier],
    ['property_type', propertyType],
    ['parcelle_subtype', propertyType === 'parcelle' ? parcelleSubtype : ''],
    ['beds_min', bedsMin],
    ['bath_min', bathMin],
    ['area_min', areaMin],
    ['price_min', priceMin],
    ['price_max', priceMax],
    ['sort', defaults.sort || ''],
    ['view', defaults.view || ''],
  ];

  const priceLabel = priceMin && priceMax
    ? `${priceMin} - ${priceMax} $`
    : priceMin
      ? `dès ${priceMin} $`
      : priceMax
        ? `max ${priceMax} $`
        : null;
  const typeLabel = propertyTypes.find((o) => o.value === propertyType)?.label;

  // Tapping the already-active pill clears it back to '' (both shown) —
  // real toggle behaviour, not just a one-way select.
  function toggleTransaction(value) {
    apply(setTransaction)(transaction === value ? '' : value);
  }

  return (
    <div className="sticky top-16 z-40 border-b border-line bg-canvas/95 backdrop-blur-md">
      <form
        id={FORM_ID}
        ref={formRef}
        action="/listings"
        method="get"
        className="mx-auto max-w-[1600px] px-4 py-2.5 sm:px-6 lg:px-8 lg:py-3"
      >
        {hidden.map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          {/* preserveParams: this box does its own client-side navigation
              (see LocationAutocomplete) rather than participating in this
              form's hidden-input/requestSubmit machinery — picking a
              location or pressing Enter here starts from the *current* URL's
              params, so price/beds/type/sort filters already set on the page
              survive a new location pick. */}
          <LocationAutocomplete
            preserveParams
            initialValue={defaults.search || ''}
            placeholder="Commune, quartier, référence…"
            ariaLabel="Rechercher"
            showIcon
            showClear
            className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 lg:max-w-md lg:py-2.5"
          />

          <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 lg:mx-0 lg:px-0">
            {/* Single-tap toggle pills, not a popover — a visitor picks
                Louer/Acheter directly with one tap, no "open panel then pick
                option" detour. Real PillOption styling (same primitive every
                other pill panel uses), just rendered outside a FilterPill
                popover this time. TRANSACTION_OPTIONS (lib/constants.js)
                still owns the real underlying values/labels used elsewhere
                (e.g. ResultsHeader); only this trigger UI changed. */}
            <div className="flex shrink-0 items-center gap-1.5">
              <PillOption selected={transaction === 'location'} onClick={() => toggleTransaction('location')}>
                Louer
              </PillOption>
              <PillOption selected={transaction === 'vente'} onClick={() => toggleTransaction('vente')}>
                Acheter
              </PillOption>
            </div>

            <FilterPill label="Prix" value={priceLabel} active={Boolean(priceMin || priceMax)}>
              <PillFieldLabel>Prix en USD</PillFieldLabel>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  placeholder="Min"
                  aria-label="Prix minimum"
                  className={numberInputClass}
                />
                <span className="text-ink-25">-</span>
                <input
                  type="number"
                  min="0"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  placeholder="Max"
                  aria-label="Prix maximum"
                  className={numberInputClass}
                />
              </div>

              {/* Same priceMin/priceMax state as the inputs above — dragging
                  a thumb updates the paired input live, typing in an input
                  moves the thumb. Doesn't submit on its own, same as the
                  inputs: Appliquer below is still the one real submit. */}
              <Slider
                className="mt-4"
                min={0}
                max={PRICE_SLIDER_MAX}
                step={5000}
                value={[
                  Math.min(Number(priceMin) || 0, PRICE_SLIDER_MAX),
                  Math.min(priceMax ? Number(priceMax) : PRICE_SLIDER_MAX, PRICE_SLIDER_MAX),
                ]}
                onValueChange={([nextMin, nextMax]) => {
                  setPriceMin(nextMin > 0 ? String(nextMin) : '');
                  setPriceMax(nextMax < PRICE_SLIDER_MAX ? String(nextMax) : '');
                }}
                aria-label="Fourchette de prix en USD"
              />
              <div className="mt-1.5 flex items-center justify-between text-[0.6875rem] text-ink-45">
                <span>0 $</span>
                <span>{PRICE_SLIDER_MAX.toLocaleString('fr-FR')} $+</span>
              </div>

              <button
                type="button"
                onClick={submit}
                className={`u-press mt-3 w-full rounded-full bg-blue py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-blue-deep ${resultPending ? 'opacity-70' : ''}`}
              >
                {resultCountLabel || 'Appliquer'}
              </button>
            </FilterPill>

            <FilterPill label="Chambres" value={bedsMin ? `${bedsMin}+ ch` : null} active={Boolean(bedsMin)}>
              <PillFieldLabel>Chambres (minimum)</PillFieldLabel>
              <div className="flex flex-wrap gap-2">
                <PillOption selected={!bedsMin} onClick={() => apply(setBedsMin)('')}>
                  Toutes
                </PillOption>
                {[1, 2, 3, 4, 5].map((n) => (
                  <PillOption key={n} selected={String(bedsMin) === String(n)} onClick={() => apply(setBedsMin)(String(n))}>
                    {n}+
                  </PillOption>
                ))}
              </div>
            </FilterPill>

            <FilterPill label="Type de bien" value={typeLabel} active={Boolean(propertyType)}>
              <PillFieldLabel>Type de bien</PillFieldLabel>
              <div className="flex flex-wrap gap-2">
                <PillOption selected={!propertyType} onClick={() => apply(setPropertyType)('')}>
                  Tous
                </PillOption>
                {/* DB-derived, with real counts — an option that would
                    return zero results is never offered. */}
                {propertyTypes.map(({ value, label, count }) => (
                  <PillOption key={value} selected={propertyType === value} onClick={() => apply(setPropertyType)(value)}>
                    {label}
                    <span className="u-tabular ml-1.5 opacity-60">{count}</span>
                  </PillOption>
                ))}
              </div>
            </FilterPill>

            <FilterPill label="Commune" value={commune} active={Boolean(commune)}>
              <PillFieldLabel>Commune</PillFieldLabel>
              <div className="max-h-60 overflow-y-auto">
                <div className="flex flex-wrap gap-2">
                  <PillOption
                    selected={!commune}
                    onClick={() => {
                      setQuartier('');
                      apply(setCommune)('');
                    }}
                  >
                    Toutes
                  </PillOption>
                  {communes.map((c) => (
                    <PillOption
                      key={c}
                      selected={commune === c}
                      onClick={() => {
                        // Quartier is scoped to a commune, so changing the
                        // commune must clear it — otherwise the query filters
                        // on a quartier that does not exist in the new one and
                        // always returns zero results.
                        setQuartier('');
                        apply(setCommune)(c);
                      }}
                    >
                      {c}
                    </PillOption>
                  ))}
                </div>
              </div>
            </FilterPill>

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={`u-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[0.8125rem] font-medium transition-colors ${
                advancedCount > 0
                  ? 'border-blue bg-blue-tint text-blue-deep'
                  : 'border-line bg-surface text-ink-70 hover:border-ink-25 hover:text-ink'
              }`}
            >
              <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              Plus de filtres
              {advancedCount > 0 ? (
                <span className="u-tabular flex h-4 min-w-4 items-center justify-center rounded-full bg-blue px-1 text-[0.625rem] font-bold text-white">
                  {advancedCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        <FiltersDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onApply={submit}
          quartiers={quartiers}
          commune={commune}
          propertyType={propertyType}
          values={{ quartier, parcelleSubtype, bathMin, areaMin }}
          setters={{ setQuartier, setParcelleSubtype, setBathMin, setAreaMin }}
          resultCountLabel={resultCountLabel}
          resultPending={resultPending}
        />
      </form>
    </div>
  );
}
