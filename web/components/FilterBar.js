'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, Map } from 'lucide-react';
import FilterPill, { PillFieldLabel, PillOption } from './FilterPill';
import FiltersDrawer from './FiltersDrawer';
import FilterModal from './FilterModal';
import LocationAutocomplete from './LocationAutocomplete';
import SaveSearchButton from './SaveSearchButton';
import { Slider } from './ui/slider';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildSearchLabel } from '@/lib/searchLabel';
import { pushRecentSearch, readRecentSearches, subscribeRecentSearches } from '@/lib/searchHistory';
import { subscribeOpenFiltersDrawer } from '@/lib/mapFilterDrawer';
import { cn } from '@/lib/utils';

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
 * panels and the "Plus de filtres"/"Filtres" sheets all render through
 * Radix portals to document.body, so any field nested inside them would sit
 * outside the form element and never be submitted. Owning the state here
 * means the panels are pure UI and there is exactly one place a filter
 * value can come from.
 *
 * Two different mobile/desktop experiences share that one state now,
 * Rightmove/Zoopla-style: desktop (`lg:` and up) keeps the full pill row
 * (Chambres/Prix/Type de bien) plus a separate "Plus de filtres" trigger
 * (FiltersDrawer.js) it always had. Below `lg`, both are replaced by a
 * single compact "Filtres" button next to the location input, opening
 * FilterModal.js — one full-screen sheet covering every field from both of
 * desktop's surfaces at once, plus a Carte/alert utility row underneath the
 * input. FilterModal and FiltersDrawer share their non-primary fields via
 * AdvancedFilterFields.js rather than duplicating that markup.
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

  // Condenses this bar's own padding once the page has scrolled a few
  // pixels — a self-contained, single-boolean scroll listener, deliberately
  // NOT the multi-branch rAF-driven Header scroll listener that used to
  // exist and was removed on purpose (see Header.js's doc comment): this
  // reads one threshold into one boolean, not nine className branches into
  // an `overHero` flag. rAF-throttled all the same, so a fast scroll can't
  // queue more than one state update per frame.
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setCondensed(window.scrollY > 8);
        ticking = false;
      });
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

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
  const [propertyType, setPropertyType] = useState(defaults.propertyType || '');
  const [parcelleSubtype, setParcelleSubtype] = useState(defaults.parcelleSubtype || '');
  const [bedsMin, setBedsMin] = useState(defaults.bedsMin || '');
  const [bathMin, setBathMin] = useState(defaults.bathMin || '');
  const [priceMin, setPriceMin] = useState(defaults.priceMin || '');
  const [priceMax, setPriceMax] = useState(defaults.priceMax || '');
  const [depositMax, setDepositMax] = useState(defaults.depositMax || '');
  const [amenities, setAmenities] = useState(defaults.amenities || []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const router = useRouter();

  // The mobile fullscreen map's floating "Filtres" button opens this same
  // FilterModal instead of a second, duplicate filter sheet — see
  // lib/mapFilterDrawer.js.
  useEffect(() => subscribeOpenFiltersDrawer(() => setFilterModalOpen(true)), []);

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

  // Live "Voir N résultats" count for the Prix popover's, the "Plus de
  // filtres" drawer's, and FilterModal's CTA buttons — all three stage
  // several field changes before one real submit, so a visitor benefits
  // from seeing the real result count update as they adjust, not just
  // after committing. Seeded from the
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
    propertyType,
    parcelleSubtype,
    bedsMin,
    bathMin,
    priceMin,
    priceMax,
    depositMax,
    amenities,
  ]);

  // "résultats", not the previous "biens" — matches the literal wording
  // asked for in the mobile filter-modal spec, and also what this same
  // label already fell back to (FiltersDrawer/FilterModal's own hardcoded
  // "Voir les résultats" when `resultCount` is still null) — the two used
  // to say different things for the same button.
  const resultCountLabel =
    resultCount == null ? null : `Voir ${resultCount.toLocaleString('fr-FR')} résultat${resultCount === 1 ? '' : 's'}`;

  const quartiers = commune ? locations[commune] || [] : [];
  // amenities is always an array (never absent) — counted by length, not by
  // ADVANCED_KEYS' plain truthiness check, since `Boolean([])` is true and
  // would otherwise always count as "1 active filter" even with nothing
  // checked.
  const advancedCount =
    ADVANCED_KEYS.filter((key) => defaults[key]).length + (defaults.amenities?.length || 0) + (defaults.depositMax ? 1 : 0);
  // Mobile's single "Filtres" button badge — the primary pills' own active
  // count (Chambres/Prix-as-one/Type de bien) plus everything advancedCount
  // already tracks, since FilterModal.js is the one screen covering both
  // sets now.
  const mobileFilterCount =
    (defaults.bedsMin ? 1 : 0) +
    (defaults.priceMin || defaults.priceMax ? 1 : 0) +
    (defaults.propertyType ? 1 : 0) +
    advancedCount;

  const isMapView = defaults.view === 'map';

  function submit() {
    formRef.current?.requestSubmit();
  }

  function toggleMapView() {
    const params = new URLSearchParams(searchParams.toString());
    if (isMapView) {
      params.delete('view');
    } else {
      params.set('view', 'map');
    }
    router.push(`/listings?${params.toString()}`);
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

  return (
    // Sticks at top-16, under the fixed Header — it stays on screen and
    // solid, same as the header above it (see Header.js's own doc comment
    // on why this app never lets its header scroll away or go transparent).
    // What actually changes on scroll is this bar's own padding and
    // elevation: shadow-sm -> shadow-md plus a touch less vertical padding
    // once `condensed`, so it visibly settles into a pinned, "in control
    // mode" state without needing the header itself to move or disappear.
    //
    // bg-canvas/95 + backdrop-blur-md deliberately do NOT live on this same
    // sticky element — confirmed live on a real iOS Safari phone: this bar
    // computed `position: sticky; top: 64px` correctly (DevTools agreed)
    // but visibly scrolled away with the page instead of pinning, the exact
    // symptom of a well-documented WebKit bug where `backdrop-filter` on a
    // `position: sticky` element breaks its own stickiness. The fix is to
    // keep `sticky` on a filter-free element and move the blurred fill onto
    // an absolutely-positioned layer behind the real content instead.
    <div
      className={cn(
        'sticky top-16 z-40 border-b border-line transition-shadow duration-300 ease-in-out',
        condensed ? 'shadow-md' : 'shadow-sm',
      )}
      // Promotes this element to its own GPU compositing layer — a
      // long-standing real workaround for older iOS Safari dropping
      // position:sticky recalculation during momentum (inertial) scrolling.
      // Inline style, not a `transform-gpu`/`will-change-transform`
      // Tailwind utility: this app has already hit Tailwind v4 silently not
      // generating an uncommon utility once (web/CLAUDE.md's grid-cols
      // gotcha), and this is a rendering hint worth guaranteeing rather
      // than trusting to compile.
      style={{ transform: 'translateZ(0)', willChange: 'transform' }}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-canvas/95 backdrop-blur-md" />
      <form
        id={FORM_ID}
        ref={formRef}
        action="/listings"
        method="get"
        className={cn(
          'relative mx-auto max-w-[1600px] px-4 transition-[padding] duration-300 ease-in-out sm:px-6 lg:px-8',
          condensed ? 'py-1.5 lg:py-2' : 'py-2.5 lg:py-3',
        )}
      >
        {hidden.map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}

        {/* Row 1: location input + a single per-breakpoint filter entry
            point. Mobile gets a compact "Filtres" button beside the input
            (opens FilterModal, the one full-screen sheet covering every
            field below); desktop keeps the full pill row + separate
            "Plus de filtres" trigger it always had (`hidden lg:flex`) —
            this was a `flex-col` stack before, with the pill row as a
            second horizontally-scrolling mobile row underneath the input;
            replaced with a real Rightmove/Zoopla-style single row now that
            mobile no longer shows the pills at all. */}
        <div className="flex w-full items-center gap-2 lg:gap-3">
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
          {/* border-2 + focus-within:border-blue: a thicker rest-state
              border and real focus feedback (there was none before — only
              the nested <input> itself can take `:focus`, so the visible
              box needs `focus-within` to react at all), per the "bolder,
              higher-contrast search input" instruction. Stays on this
              app's own `--blue` focus token rather than a literal dark
              slate-900 border, matching `.u-focus-ring`'s established
              focus colour used everywhere else a field gets one. */}
          <LocationAutocomplete
            preserveParams
            initialValue={defaults.search || ''}
            placeholder="Commune, quartier, référence…"
            ariaLabel="Rechercher"
            showIcon
            showClear
            recentSearches={recentSearches}
            className="min-w-0 flex-1 rounded-lg border-2 border-line bg-surface px-4 py-2 transition-colors focus-within:border-blue lg:min-w-[15rem] lg:py-2.5"
            inputClassName="font-medium"
          />

          {/* Mobile-only single filter entry point — replaces the pill row
              (Chambres/Prix/Type de bien) and the separate "Plus de
              filtres" trigger below, both hidden below lg now. Opens
              FilterModal.js. */}
          <button
            type="button"
            onClick={() => setFilterModalOpen(true)}
            className={`u-press inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border-2 px-4 py-2 text-[0.8125rem] font-semibold transition-colors lg:hidden ${
              mobileFilterCount > 0
                ? 'border-blue bg-blue-tint text-blue-deep'
                : 'border-line bg-surface text-ink-70'
            }`}
          >
            <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Filtres
            {mobileFilterCount > 0 ? (
              <span className="u-tabular flex h-4 min-w-4 items-center justify-center rounded-full bg-blue px-1 text-[0.625rem] font-bold text-white">
                {mobileFilterCount}
              </span>
            ) : null}
          </button>

          <div className="hidden items-center gap-2 lg:flex">
            {/* Zoopla's own bar order minus Radius (removed for now — see
                lib/listings.js's buildFilters and ResultsHeader.js, which
                still honour a `radius` param arriving via a bookmarked/
                shared URL, just with no UI control left in this bar to set
                or change it): Bedrooms -> Price -> Property type -> More
                filters -> Save. Rent/Buy is already handled by the header
                nav and the URL's transaction_type param (see Header.js),
                and "Commune" as a separate structured pill was dropped — it
                duplicated the location input above, which already resolves
                a typed/picked place to a real commune (see
                LocationAutocomplete/searchParser and FiltersDrawer's own
                hint pointing here). */}
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

        {/* Row 2, mobile only: Zoopla's own secondary utility bar directly
            beneath the search input — a real map-view toggle (the same
            `?view=map` param the map/list split has always used; this is
            now the ONLY mobile entry point to it, since FloatingControlBar.js
            — the floating "Carte / Trier" pill that used to duplicate this
            same toggle — has been removed entirely, see
            app/(site)/listings/page.js) and the real save-search/alert
            action (SaveSearchButton's `variant="alert"` — see its own doc
            comment for why this is the same feature relabelled, not a
            second implementation). */}
        <div className="mt-2 flex items-center divide-x divide-line border-t border-line lg:hidden">
          <button
            type="button"
            onClick={toggleMapView}
            className="u-press flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[0.8125rem] font-semibold text-ink-70 transition-colors hover:text-blue-deep"
          >
            <Map strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {isMapView ? 'Vue liste' : 'Carte'}
          </button>
          <SaveSearchButton variant="alert" />
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

        <FilterModal
          open={filterModalOpen}
          onClose={() => setFilterModalOpen(false)}
          onApply={submit}
          propertyTypes={propertyTypes}
          quartiers={quartiers}
          commune={commune}
          priceSliderMax={PRICE_SLIDER_MAX}
          values={{ propertyType, priceMin, priceMax, bedsMin, bathMin, quartier, parcelleSubtype, depositMax, amenities }}
          setters={{
            setPropertyType, setPriceMin, setPriceMax, setBedsMin, setBathMin,
            setQuartier, setParcelleSubtype, setDepositMax, setAmenities,
          }}
          resultCountLabel={resultCountLabel}
          resultPending={resultPending}
        />
      </form>
    </div>
  );
}
