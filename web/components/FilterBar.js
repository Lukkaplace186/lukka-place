'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import FilterPill, { PillFieldLabel, PillOption } from './FilterPill';
import FiltersDrawer from './FiltersDrawer';
import LocationAutocomplete from './LocationAutocomplete';
import SaveSearchButton from './SaveSearchButton';
import { Slider } from './ui/slider';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildSearchLabel } from '@/lib/searchLabel';
import { pushRecentSearch, readRecentSearches, subscribeRecentSearches } from '@/lib/searchHistory';
import { subscribeOpenFiltersDrawer } from '@/lib/mapFilterDrawer';

const FORM_ID = 'listings-filter-form';
const ADVANCED_KEYS = ['quartier', 'parcelleSubtype', 'bathMin'];
// Recording a "recent search" only makes sense once at least one of these
// is set — a bare /listings visit with none of them isn't a search worth
// remembering. sort/view/page deliberately excluded: they don't filter the
// result set, so changing only those shouldn't spawn a new history entry.
const FILTER_PARAM_KEYS = [
  'transaction_type', 'commune', 'quartier', 'radius', 'property_type', 'parcelle_subtype',
  'price_min', 'price_max', 'beds_min', 'bath_min', 'deposit_max', 'amenities', 'q', 'reference',
];
// Fallback only for the genuinely-empty-catalog case (lib/listings.js's
// getPriceRange() returns null) — otherwise the real ceiling comes from
// `priceCeiling` below, derived live from the highest approved-listing
// price (same "don't hardcode what the database can answer" principle as
// getPropertyTypeFacets()). Typing a higher value into the Max input still
// filters correctly regardless; this only sets where the slider's own top
// end sits.
const PRICE_SLIDER_FALLBACK_MAX = 500000;

const numberInputClass =
  'u-focus-ring w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-25';

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
export default function FilterBar({ locations, propertyTypes = [], initialTotal, priceCeiling, defaults = {} }) {
  const formRef = useRef(null);

  // Real max price, rounded up to a clean $10,000 step for a tidy slider —
  // not padded with invented headroom above it, and never below what's
  // already visible in `defaults.priceMax` (a saved/bookmarked search for
  // more than today's current max shouldn't render its own value off the
  // end of the slider).
  const PRICE_SLIDER_MAX = Math.max(
    priceCeiling ? Math.ceil(priceCeiling / 10000) * 10000 : PRICE_SLIDER_FALLBACK_MAX,
    Number(defaults.priceMax) || 0,
  );

  const [transaction] = useState(defaults.transactionType || '');
  // No local setter: commune is no longer chosen via a pill in this bar — it
  // only ever comes from the location input above (a full navigation that
  // remounts this component with a new `defaults.commune`) or the URL.
  const [commune] = useState(defaults.commune || '');
  const [quartier, setQuartier] = useState(defaults.quartier || '');
  const [radius, setRadius] = useState(defaults.radius || '');
  const [propertyType, setPropertyType] = useState(defaults.propertyType || '');
  const [parcelleSubtype, setParcelleSubtype] = useState(defaults.parcelleSubtype || '');
  const [bedsMin, setBedsMin] = useState(defaults.bedsMin || '');
  const [bathMin, setBathMin] = useState(defaults.bathMin || '');
  const [priceMin, setPriceMin] = useState(defaults.priceMin || '');
  const [priceMax, setPriceMax] = useState(defaults.priceMax || '');
  const [depositMax, setDepositMax] = useState(defaults.depositMax || '');
  const [amenities, setAmenities] = useState(defaults.amenities || []);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // The mobile fullscreen map's floating "Filtres" button opens this same
  // drawer instead of a second, duplicate filter sheet — see
  // lib/mapFilterDrawer.js.
  useEffect(() => subscribeOpenFiltersDrawer(() => setDrawerOpen(true)), []);

  // Recent searches (lib/searchHistory.js) — a real, local-only history of
  // whatever filter combination was actually applied here, distinct from
  // LocationAutocomplete.js's own AI-mode-only history (raw typed
  // sentences for the homepage hero box; this is structured-filter
  // summaries for this page). useSyncExternalStore, not
  // useState+useEffect+readRecentSearches(): same pattern lib/
  // localFavorites.js/SaveSearchButton.js already use for this exact kind
  // of "read a browser-only store, re-render when it changes" case — it
  // also means the write effect below never needs to call setState itself,
  // since the CustomEvent it dispatches on write is what this subscription
  // reacts to. `() => []` server snapshot: localStorage doesn't exist
  // server-side, same reasoning FavoriteButton.js already documents.
  const recentSearches = useSyncExternalStore(subscribeRecentSearches, readRecentSearches, () => []);
  const searchParams = useSearchParams();

  useEffect(() => {
    const hasActiveFilter = FILTER_PARAM_KEYS.some((key) => searchParams.get(key));
    if (!hasActiveFilter) return;
    const href = `/listings?${searchParams.toString()}`;
    pushRecentSearch({ label: buildSearchLabel(searchParams), href });
  }, [searchParams]);

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
      if (priceMin) qs.set('price_min', priceMin);
      if (priceMax) qs.set('price_max', priceMax);
      if (commune && radius) qs.set('radius', radius);
      if (depositMax) qs.set('deposit_max', depositMax);
      if (amenities.length) qs.set('amenities', amenities.join(','));

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
  }, [
    transaction,
    commune,
    quartier,
    radius,
    propertyType,
    parcelleSubtype,
    bedsMin,
    bathMin,
    priceMin,
    priceMax,
    depositMax,
    amenities,
  ]);

  const resultCountLabel =
    resultCount == null ? null : `Voir ${resultCount.toLocaleString('fr-FR')} bien${resultCount === 1 ? '' : 's'}`;

  const quartiers = commune ? locations[commune] || [] : [];
  // amenities is always an array (never absent) — counted by length, not by
  // ADVANCED_KEYS' plain truthiness check, since `Boolean([])` is true and
  // would otherwise always count as "1 active filter" even with nothing
  // checked.
  const advancedCount =
    ADVANCED_KEYS.filter((key) => defaults[key]).length + (defaults.amenities?.length || 0) + (defaults.depositMax ? 1 : 0);

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
    // form's requestSubmit() (every price/beds/type pill) only submits the
    // named fields listed here — `q` was missing, so toggling any other pill
    // silently dropped whatever the visitor had typed. Confirmed live:
    // `?q=appartement&price_max=2000` -> click "Chambres" -> 1+ ->
    // `?beds_min=1&price_max=2000`, `q` gone.
    ['q', defaults.search || ''],
    ['transaction_type', transaction],
    ['commune', commune],
    ['quartier', quartier],
    // Only meaningful once a commune is picked — lib/listings.js's
    // buildFilters ignores it otherwise.
    ['radius', commune ? radius : ''],
    ['property_type', propertyType],
    ['parcelle_subtype', propertyType === 'parcelle' ? parcelleSubtype : ''],
    ['beds_min', bedsMin],
    ['bath_min', bathMin],
    ['price_min', priceMin],
    ['price_max', priceMax],
    ['deposit_max', depositMax],
    ['amenities', amenities.join(',')],
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

  // Hierarchy tiers (quartier -> commune -> Kinshasa) plus, since the
  // 2026-08-23 geocoding backfill (scripts/geocode-listings.js), real
  // kilometer options — Haversine-measured in lib/listings.js from the
  // commune's real Google-geocoded centroid against each listing's own real
  // coordinates. A third hierarchy tier only appears once a quartier is
  // actually selected (via "Plus de filtres"): dropping straight from
  // quartier to city would silently skip past the commune-wide option a
  // visitor might actually want.
  const KM_OPTIONS = [1, 3, 5];
  const radiusLabel = KM_OPTIONS.includes(Number(radius))
    ? `+${radius} km`
    : radius === 'citywide'
      ? 'Toute la ville'
      : radius === 'commune'
        ? 'Toute la commune'
        : null;

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

        <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          {/* preserveParams: this box does its own client-side navigation
              (see LocationAutocomplete) rather than participating in this
              form's hidden-input/requestSubmit machinery — picking a
              location or pressing Enter here starts from the *current* URL's
              params, so price/beds/type/sort filters already set on the page
              survive a new location pick.

              No lg:max-w-md cap (Zoopla-width pass): capping this while the
              pill row next to it has no flex-grow of its own left dead space
              between "Sauvegarder" and the container's right edge on wide
              viewports — nothing was claiming the slack. flex-1 with no cap
              means this box now absorbs all remaining row width itself, so
              the pill row (already shrink-0 per control, see FilterPill.js)
              lands flush against the real right edge instead. */}
          <LocationAutocomplete
            preserveParams
            initialValue={defaults.search || ''}
            placeholder="Commune, quartier, référence…"
            ariaLabel="Rechercher"
            showIcon
            showClear
            recentSearches={recentSearches}
            className="min-w-0 w-full flex-1 rounded-lg border border-line bg-surface px-4 py-2 lg:min-w-[15rem] lg:py-2.5"
          />

          <div className="-mx-4 flex w-full items-center gap-2 overflow-x-auto px-4 pb-0.5 lg:mx-0 lg:w-auto lg:px-0">
            {/* Zoopla's own bar order: Location -> Radius -> Bedrooms ->
                Price -> Property type -> More filters -> Save. Rent/Buy is
                already handled by the header nav and the URL's
                transaction_type param (see Header.js), and "Commune" as a
                separate structured pill was dropped — it duplicated the
                location input above, which already resolves a typed/picked
                place to a real commune (see LocationAutocomplete/
                searchParser and FiltersDrawer's own hint pointing here). */}
            {commune ? (
              <FilterPill label="Rayon" value={radiusLabel} active={Boolean(radius)}>
                <PillFieldLabel>Rayon de recherche</PillFieldLabel>
                <div className="flex flex-wrap gap-2">
                  {quartier ? (
                    <PillOption selected={!radius} onClick={() => apply(setRadius)('')}>
                      Ce quartier uniquement
                    </PillOption>
                  ) : (
                    <PillOption selected={!radius} onClick={() => apply(setRadius)('')}>
                      Cette commune uniquement
                    </PillOption>
                  )}
                  {KM_OPTIONS.map((km) => (
                    <PillOption key={km} selected={radius === String(km)} onClick={() => apply(setRadius)(String(km))}>
                      +{km} km
                    </PillOption>
                  ))}
                  {quartier ? (
                    <PillOption selected={radius === 'commune'} onClick={() => apply(setRadius)('commune')}>
                      Toute la commune
                    </PillOption>
                  ) : null}
                  <PillOption selected={radius === 'citywide'} onClick={() => apply(setRadius)('citywide')}>
                    Toute la ville
                  </PillOption>
                </div>
                <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-45">
                  {KM_OPTIONS.includes(Number(radius))
                    ? `Distance réelle depuis le centre de la commune — mesurée pour les biens géolocalisés, complétée par les biens de ${commune} non encore géolocalisés.`
                    : 'Basé sur les communes/quartiers renseignés. Les options en km ci-dessus utilisent une distance réelle depuis le centre de la commune.'}
                </p>
              </FilterPill>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border border-line bg-canvas-alt px-3.5 py-2 text-[0.8125rem] font-medium text-ink-25"
              >
                Rayon
              </span>
            )}

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
                className={`u-press mt-3 w-full rounded-full bg-blue py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary ${resultPending ? 'opacity-70' : ''}`}
              >
                {resultCountLabel || 'Appliquer'}
              </button>
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

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className={`u-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3.5 py-2 text-[0.8125rem] font-medium transition-colors ${
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

            {/* Zoopla's final toolbar slot. Real, already-built local-only
                save (see SaveSearchButton.js/lib/favorites.js) — moved here
                from ResultsHeader.js to match the reference layout; it's
                type="button" so it can't trigger this form's submit. */}
            <SaveSearchButton />
          </div>
        </div>

        <FiltersDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onApply={submit}
          quartiers={quartiers}
          commune={commune}
          propertyType={propertyType}
          values={{ quartier, parcelleSubtype, bedsMin, bathMin, depositMax, amenities }}
          setters={{ setQuartier, setParcelleSubtype, setBedsMin, setBathMin, setDepositMax, setAmenities }}
          resultCountLabel={resultCountLabel}
          resultPending={resultPending}
        />
      </form>
    </div>
  );
}
