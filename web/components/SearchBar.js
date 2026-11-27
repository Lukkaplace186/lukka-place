'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import QueryAlertButton from './QueryAlertButton';
import { feedAlertQuery, feedAlertReady } from '@/lib/feedAlertRules';
import { HERO_DEFAULT_TAB, HERO_TRANSACTION_BY_TAB, ICON_STROKE_WIDTH } from '@/lib/constants';
// Loaded after first paint (lib/searchEngine.js, phone speed 2026-11-26).
import { loadSearchEngine, searchEngineNow, useSearchEngine } from '@/lib/searchEngine';
import { understoodChips } from '@/lib/searchUnderstood';
import { useT } from '@/lib/i18n/client';
import { facetLabel, groupTypeFacets } from '@/lib/commercialSpaces';
import { budgetOptions, budgetParams } from '@/lib/budgetSteps';
import { frNumber } from '@/lib/format';
import { ALL_CITIES, CITIES, DEFAULT_CITY, cityOfCommune } from '@/lib/cities';
import { bedsOptions, heroBedsParams, studioOffered, typeHasBedrooms } from '@/lib/heroBedrooms';

/**
 * The hero search panel — a white card floating over the hero photograph,
 * in four tiers, top to bottom (2026-10-23 redesign, from the owner's
 * mock-ups):
 *
 *   1. a segmented Louer / Courte durée / Acheter toggle
 *   2. labelled boxes: "Ville" (a dropdown, back on 2026-10-24 at the
 *      owner's request — picking is easier than typing for most visitors),
 *      "Commune ou quartier" (free text), "Type de bien", then Budget
 *      Min | Max. Courte durée shows a one-line explanation instead of type
 *      and budget.
 *   3. the primary CTA, full width; on Louer it carries the live count
 *   4. a scrollable row of commune quick-pills that fill the location field
 *
 * COURTE DURÉE HAS NO DATES / VOYAGEURS FIELDS, deliberately. The mock-up
 * has them, but no listing carries an availability calendar or a guest
 * capacity, so both would be inputs that filter nothing — a fake control.
 * The tab is `lease_term=short` (a rent quoted per day or week). Add the two
 * fields when the data behind them exists.
 *
 * PALETTE: the brief specified `slate-*` / `primary` Tailwind classes.
 * Those are deliberately mapped onto this app's own tokens instead — the
 * ink/canvas/line/blue ramp in `app/globals.css` — because both CLAUDE.md
 * files are explicit that off-palette built-in Tailwind scales don't belong
 * here (`--color-primary` is a shadcn remap, not this design's action
 * colour; `slate` is the exact "reads as a typo next to our own token"
 * case the root file calls out). The visual result is the intended one:
 * white card, hairline dividers, sunken field block, tinted active chips.
 * Elevation uses `.u-shadow-panel`, the token that exists for precisely
 * this panel, rather than a generic `shadow-xl`.
 *
 * BUDGET IS A RANGE (2026-10-24, owner request: "from $200 to $300, not
 * just max"): two native `<select>`s, Min and Max, side by side under one
 * "Budget" label, with the steps in lib/budgetSteps.js (rent to 10 000 $ +,
 * sale on its own scale). Native selects, not a Popover: the documented iOS
 * Safari misplacement came from Radix's Popper applying a CSS `transform`
 * to the panel, and nothing on this card's ancestor chain carries one.
 *
 * `propertyTypes` and `communes` are both real and DB-derived
 * (`getPropertyTypeFacets()` / `getPopularCommunes()`, from the homepage's
 * own server component), so neither the type dropdown nor a quick-pill
 * ever offers something with zero results behind it. The budget steps are
 * a fixed set of round figures — a filter-UI convenience, not a claim about
 * the data — feeding the same `price_min` / `price_max` params FilterBar
 * already submits.
 *
 * CHAMBRES (2026-11-25, owner request, Rightmove-style): a Min | Max pair
 * between Type and Budget, built like the budget pair — Studio, 1 … 5, the
 * other side's contradicting options disabled — so "2 to 4 chambres" is two
 * taps. Studio is bound 0, which the listings filter reads as the Studio
 * type; the pair hides for land, commercial space and studios. See
 * lib/heroBedrooms.js and lib/bedroomRange.js.
 *
 * Placeholder copy says "référence" (never "repère"), per the root
 * CLAUDE.md.
 */
const HOME_TABS = [
  { value: 'louer', labelKey: 'home.search.rent' },
  { value: 'courte', labelKey: 'home.search.shortTerm' },
  { value: 'acheter', labelKey: 'home.search.buy' },
];

// Both live in lib/constants.js because the homepage's server component
// needs the same mapping to scope `initialCount` to the tab this opens on.

/*
 * Built per language: the words AND the thousands separator differ
 * ("Min 1 500 $" vs "Min $1,500"). Memoised at the call site.
 */
export function budgetLabels(t) {
  const format = (amount) => (t.locale === 'en' ? amount.toLocaleString('en-GB') : frNumber(amount));
  const labels = {
    minAny: t('home.search.budgetMinAny'),
    maxAny: t('home.search.budgetMaxAny'),
    min: (amount) => t('home.search.budgetMin', { amount }),
    max: (amount) => t('home.search.budgetMax', { amount }),
    over: (amount) => t('home.search.budgetOver', { amount }),
  };
  return { format, labels };
}

// The hero's own list and order (owner, 2026-10-24): Kinshasa (the
// default), "Toutes les villes" — a real nationwide search, ville=toutes
// (lib/cities.js ALL_CITIES) — then the cities with the most demand. Likasi,
// Kananga, Boma and Muanda are left out here only; /listings' city picker
// and the search box still know them. A name not in lib/cities.js is dropped
// rather than offered as a search that matches nothing.
const HERO_CITY_ORDER = ['Lubumbashi', 'Goma', 'Bukavu', 'Kisangani', 'Kolwezi', 'Matadi', 'Mbuji-Mayi'];
const CITY_OPTIONS = [
  DEFAULT_CITY,
  ALL_CITIES,
  ...HERO_CITY_ORDER.filter((name) => CITIES.some((c) => c.name === name)),
];

const COUNT_DEBOUNCE_MS = 350;


/*
 * Separate labelled boxes (2026-10-23 redesign), not the fused divided block
 * this used to be: a visible label above each box and no leading icons, so on
 * a 375px phone both selects get their whole width. A native <select> shows
 * the chosen option's own text, which is why the budget steps read
 * "Max 1 500 $" — short enough for a half-width box.
 */
const FIELD_BOX =
  'relative flex min-h-[3.25rem] min-w-0 items-center lg:min-h-11 2xl:min-h-[3.25rem] gap-2 rounded-xl border border-ink-25 bg-surface px-4 transition-colors ' +
  'focus-within:border-blue focus-within:shadow-[0_0_0_3px_var(--blue-tint)]';

const FIELD_LABEL = 'mb-2 block text-[0.9375rem] font-bold text-ink lg:mb-1.5 lg:text-sm 2xl:mb-2 2xl:text-[0.9375rem]';

const FIELD_SELECT =
  'min-w-0 flex-1 cursor-pointer truncate appearance-none bg-transparent py-3 text-[0.9375rem] lg:py-2 2xl:py-3 ' +
  'text-ink focus:outline-none';

/*
 * `compact` is the app's home screen (components/AppHomeTop.js, 2026-11-12):
 * tabs, one field with the criteria button beside it, and the button, so the
 * first listings reach the first screen. The field's label stays for screen
 * readers, and the commune pills move under the card (AppHomeTop draws them).
 */
export default function SearchBar({ propertyTypes = [], communes = [], initialCount = null, compact = false }) {
  const t = useT();
  const [homeTab, setHomeTab] = useState(HERO_DEFAULT_TAB);
  const [propertyType, setPropertyType] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  // HERO_BED_STEPS values as strings ('0' = Studio), or '' for no bound.
  const [bedsMin, setBedsMin] = useState('');
  const [bedsMax, setBedsMax] = useState('');
  // The city searched (?ville=). A city, or another city's commune, typed in
  // the box wins over it (lib/searchParser.js), and the select follows it.
  const [ville, setVille] = useState(DEFAULT_CITY);
  // Mirrors the location field's text. LocationAutocomplete still owns the
  // input itself; this is the copy the quick-pill tint and the live count
  // read, kept in step through its `onValueChange`/`setQuery` pair.
  const [location, setLocation] = useState('');
  // Phones only: Ville, Type and Budget fold behind "Plus de critères" so
  // the button and the first listings reach the first screen (2026-11-04:
  // the full card pushed "Voir N biens" to 835px on a 812px phone and the
  // first listing photo to ~1,066px). From `sm` up every field shows.
  const [moreOpen, setMoreOpen] = useState(false);
  const locationRef = useRef(null);

  const transactionType = HERO_TRANSACTION_BY_TAB[homeTab] || '';
  const isShortStay = homeTab === 'courte';
  // Louer stays every rent, as before the third tab; Courte durée is the
  // rents quoted per day or week (lib/leaseTerm.js). Type and budget are not
  // offered there, so they are not sent either.
  const leaseTerm = isShortStay ? 'short' : '';
  const stagedType = isShortStay ? '' : propertyType;
  const staged = isShortStay ? { price_min: '', price_max: '' } : budgetParams(budgetMin, budgetMax);
  const stagedMin = staged.price_min;
  const stagedMax = staged.price_max;
  const bedsShown = !isShortStay && typeHasBedrooms(propertyType, propertyTypes);
  const stagedBeds = bedsShown ? heroBedsParams(bedsMin, bedsMax) : { beds_min: '', beds_max: '' };
  // Desktop columns. With the bedroom pair there are five fields: one row
  // from 1280px, and from 1024 to 1279px Ville / Commune / Type on top and the
  // two Min | Max pairs under them (in one row their selects cut "2 ch." and
  // "Min 200 $" short). Literal strings so Tailwind generates them.
  const spanTop = bedsShown ? 'lg:col-span-2 xl:col-span-1' : 'lg:col-span-1';
  const spanPair = bedsShown ? 'lg:col-span-3 xl:col-span-1' : 'lg:col-span-1';
  const bedSelects = useMemo(
    () =>
      bedsOptions(
        { min: bedsMin, max: bedsMax },
        {
          minAny: t('home.search.budgetMinAny'),
          maxAny: t('home.search.budgetMaxAny'),
          studio: t('home.search.studio'),
          count: (count) => t('home.search.bedsCount', { count }),
        },
        { studio: studioOffered(propertyTypes) },
      ),
    [t, bedsMin, bedsMax, propertyTypes],
  );
  // Rebuilt when the language, the scale (rent / sale) or a chosen bound
  // changes: a bound disables the options on the other side that would
  // contradict it.
  const { minOptions, maxOptions } = useMemo(() => {
    const { format, labels } = budgetLabels(t);
    return budgetOptions(transactionType, { min: budgetMin, max: budgetMax }, format, labels);
  }, [t, transactionType, budgetMin, budgetMax]);

  const extraParams = {
    transaction_type: transactionType,
    property_type: stagedType,
    price_min: stagedMin,
    price_max: stagedMax,
    beds_min: stagedBeds.beds_min,
    beds_max: stagedBeds.beds_max,
    lease_term: leaseTerm,
    ville,
  };

  // A pill is lit only while the field literally still holds that commune's
  // name — see LocationAutocomplete's `onValueChange` note. Comparison is
  // trimmed + case-insensitive so "gombe " still counts as Gombe.
  const normalizedLocation = location.trim().toLowerCase();

  // The Ville select follows the place in the box: tapping the "Lubumbashi"
  // chip or typing "Kampemba" shows Lubumbashi, a Kinshasa place shows
  // Kinshasa — the city the search will actually run in.
  function cityOfText(text) {
    if (String(text || '').trim().length < 3) return null;
    const engine = searchEngineNow();
    if (!engine) return null;
    const parsed = engine.parseSearchQuery(text);
    if (parsed.ville) return parsed.ville;
    return parsed.commune ? cityOfCommune(parsed.commune) || DEFAULT_CITY : null;
  }

  function onLocationChange(text) {
    setLocation(text);
    const apply = () => {
      const city = cityOfText(text);
      if (city) setVille(city);
    };
    if (searchEngineNow()) apply();
    else loadSearchEngine().then(apply).catch(() => {});
  }

  // Picking another city clears a place of a different city from the box,
  // so the select and the text never point at two cities. "Toutes les villes"
  // keeps it: a commune typed there still narrows the search to it.
  function onCityChange(next) {
    setVille(next);
    const typed = cityOfText(location);
    if (next && next !== ALL_CITIES && typed && typed !== next) locationRef.current?.setQuery('');
  }

  // ---- Live result count -------------------------------------------------
  // Real `/api/listings/count` (the same endpoint FilterBar's Prix popover
  // uses — same parseListingsSearchParams, same getListings, same approved
  // filter), never a client-side guess. `initialCount` is the server's own
  // total for the default tab so the button ships with a real number in its
  // first paint instead of flashing a placeholder.
  const [count, setCount] = useState(initialCount);
  // Alternatives the results page would show when the exact count is zero
  // (the count endpoint's `suggested`) — see lib/listings.js relaxSearch.
  const [suggested, setSuggested] = useState(0);
  const isFirstRun = useRef(true);

  // The search the button opens, as /listings params: the count asks for it,
  // and the bell beside the button (2026-11-24) saves it as an alert.
  // `parseSearchQuery` is null until lib/searchEngine.js has loaded the parser:
  // the typed text then adds nothing yet (the count effect awaits the parser).
  function stagedQuery(parseSearchQuery) {
    const qs = new URLSearchParams();
    if (transactionType) qs.set('transaction_type', transactionType);
    if (stagedType) qs.set('property_type', stagedType);
    if (stagedMin) qs.set('price_min', stagedMin);
    if (stagedMax) qs.set('price_max', stagedMax);
    if (stagedBeds.beds_min) qs.set('beds_min', stagedBeds.beds_min);
    if (stagedBeds.beds_max) qs.set('beds_max', stagedBeds.beds_max);
    if (leaseTerm) qs.set('lease_term', leaseTerm);
    if (ville) qs.set('ville', ville);

    // Parsed exactly the way submitting parses it (LocationAutocomplete's
    // submitFreeText -> applyParsedFilters), and in the same precedence:
    // what was typed wins over the selects, so the count describes the
    // page the button actually navigates to.
    const parsed = parseSearchQuery ? parseSearchQuery(location) : {};
    if (parsed.reference) qs.set('reference', parsed.reference);
    if (parsed.transaction_type) qs.set('transaction_type', parsed.transaction_type);
    if (parsed.price_min != null) qs.set('price_min', String(parsed.price_min));
    if (parsed.price_max != null) qs.set('price_max', String(parsed.price_max));
    if (parsed.beds_min != null) qs.set('beds_min', String(parsed.beds_min));
    if (parsed.bath_min != null) qs.set('bath_min', String(parsed.bath_min));
    if (parsed.lease_term) qs.set('lease_term', parsed.lease_term);
    if (parsed.plot_min != null) qs.set('plot_min', String(parsed.plot_min));
    if (parsed.amenities?.length) qs.set('amenities', parsed.amenities.join(','));
    if (parsed.property_type) {
      qs.set('property_type', parsed.property_type);
      if (parsed.parcelle_subtype) qs.set('parcelle_subtype', parsed.parcelle_subtype);
    }
    if (parsed.ville) qs.set('ville', parsed.ville);
    if (parsed.commune) {
      qs.set('commune', parsed.commune);
      if (parsed.communes?.length > 1) qs.set('communes', parsed.communes.join(','));
      if (parsed.quartier) qs.set('quartier', parsed.quartier);
    }
    if (parsed.keywords) qs.set('q', parsed.keywords);
    return qs;
  }

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      // The parser arrives after first paint (lib/searchEngine.js).
      let loaded;
      try {
        loaded = await loadSearchEngine();
      } catch {
        return; // keep the last real count
      }
      if (controller.signal.aborted) return;
      const qs = stagedQuery(loaded.parseSearchQuery);

      fetch(`/api/listings/count?${qs.toString()}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((json) => {
          if (typeof json.total === 'number') setCount(json.total);
          setSuggested(typeof json.suggested === 'number' ? json.suggested : 0);
        })
        .catch(() => {
          // Aborted (a newer change superseded this request) or a real
          // network error — either way keep the last known real count
          // rather than blanking the CTA to something fabricated.
        });
    }, COUNT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // stagedQuery reads exactly these values; listing them keeps the debounce
    // tied to what the visitor changed rather than to every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionType, stagedType, stagedMin, stagedMax, stagedBeds.beds_min, stagedBeds.beds_max, leaseTerm, ville, location]);

  // What the parser takes from the typed text, read back as chips — so a
  // visitor sees that "Gombe" and "2 chambres" were understood before they
  // search. Never a filter of its own (lib/searchUnderstood.js).
  const engine = useSearchEngine();
  const understood = useMemo(
    () => (engine && location.trim().length >= 3 ? understoodChips(engine.parseSearchQuery(location), t) : []),
    [location, t, engine],
  );

  function applyCommune(name) {
    // Tapping the lit pill clears it — a one-tap filter needs a one-tap
    // undo, otherwise the only way out of a chip is to select its text.
    const next = normalizedLocation === name.trim().toLowerCase() ? '' : name;
    locationRef.current?.setQuery(next);
  }

  function submit() {
    locationRef.current?.submit();
  }

  // The live count is the label on every tab ("Voir 12 biens"). Until a
  // tab's own count has arrived (it is reset on a tab switch, so the rent
  // total never shows under Acheter), or when nothing matches, the tab's own
  // call to action stands in; a zero-result search says it will show
  // suggestions when there are some.
  // Criteria set in the folded fields, so a closed fold never hides a choice.
  const foldedActive = [ville !== DEFAULT_CITY, Boolean(propertyType), Boolean(stagedBeds.beds_min || stagedBeds.beds_max), Boolean(budgetMin), Boolean(budgetMax)].filter(Boolean).length;
  const folded = moreOpen ? '' : 'max-sm:hidden';
  const criteriaButton = (
    <button
      type="button"
      aria-expanded={moreOpen}
      aria-controls={`hero-city hero-type${bedsShown ? ' hero-beds-min hero-beds-max' : ''} hero-budget-min hero-budget-max`}
      aria-label={moreOpen ? t('home.search.fewerCriteria') : t('home.search.moreCriteria')}
      onClick={() => setMoreOpen((open) => !open)}
      className={`u-press relative flex h-[3.25rem] w-[3.25rem] flex-none items-center justify-center rounded-xl border transition-colors sm:hidden ${
        moreOpen || foldedActive > 0 ? 'border-blue bg-blue-tint text-blue-deep' : 'border-ink-25 bg-surface text-ink'
      }`}
    >
      <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
      {!moreOpen && foldedActive > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-deep px-1.5 text-[0.75rem] font-bold text-white">
          {foldedActive}
        </span>
      ) : null}
    </button>
  );

  // "M'alerter" beside the results button (2026-11-24): once the search names
  // a commune or a quartier (every listing of the city is the feed, not an
  // alert — lib/feedAlertRules.js), the same search saved as a WhatsApp alert.
  const stagedParams = Object.fromEntries(stagedQuery(engine?.parseSearchQuery));
  const alertQuery = feedAlertReady(stagedParams) ? feedAlertQuery(stagedParams) : null;

  let ctaLabel;
  if (count === 0 && suggested > 0) ctaLabel = t('home.search.seeSuggestions', { count: suggested });
  else if (count != null && count > 0) ctaLabel = t('home.search.seeCount', { count });
  else if (homeTab === 'acheter') ctaLabel = t('home.search.seeForSale');
  else if (isShortStay) ctaLabel = t('home.search.seeShortStays');
  else ctaLabel = t('home.search.submit');

  return (
    <div className={`overflow-hidden bg-surface u-shadow-panel sm:p-5 ${compact ? 'rounded-card p-3.5' : 'rounded-3xl border border-line p-4'}`}>
      {/* --- 1. Intent toggle ------------------------------------------- */}
      <div
        role="tablist"
        aria-label={t('home.search.transactionType')}
        // Widths follow the labels (flex-auto), not three equal columns:
        // "Courte durée" does not fit a third of a 375px card.
        className={`${compact ? 'mb-3 rounded-xl' : 'mb-4 rounded-2xl'} flex w-full gap-1 bg-canvas-alt p-1 sm:mb-5 sm:inline-flex sm:w-auto`}
      >
        {HOME_TABS.map(({ value, labelKey }) => {
          const on = homeTab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={on}
              // The location field is keyed on `homeTab` and REMOUNTS here
              // (a stray typed value shouldn't carry from one transaction
              // context into another), which empties the input without
              // going through `onValueChange` — so the mirror has to be
              // cleared by hand, or a pill stays lit and the live count keeps
              // filtering on a commune the now-empty field no longer holds.
              onClick={() => {
                if (value === homeTab) return;
                setHomeTab(value);
                setLocation('');
                // Rent and sale have different scales: a $500 floor means
                // nothing under Acheter.
                setBudgetMin('');
                setBudgetMax('');
                // The previous tab's count describes other listings; the
                // effect fetches this tab's own.
                setCount(null);
                setSuggested(0);
              }}
              className={`u-press flex-auto whitespace-nowrap px-3 text-[0.9375rem] font-semibold transition-colors sm:px-6 ${compact ? 'min-h-11 rounded-lg' : 'min-h-12 rounded-xl'} ${
                on
                  ? 'bg-surface text-ink shadow-[var(--shadow-card)]'
                  : 'text-ink-45 hover:text-ink'
              }`}
            >
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      {/* --- 2. Labelled fields ------------------------------------------ */}
      <div
        className={`grid grid-cols-2 gap-x-3 gap-y-4 ${
          isShortStay
            ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
            : bedsShown
              ? 'lg:grid-cols-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.4fr)]'
              : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)]'
        }`}
      >
        <div className={`col-span-2 min-w-0 ${spanTop} ${folded}`}>
          <label htmlFor="hero-city" className={FIELD_LABEL}>
            {t('home.search.city')}
          </label>
          <div className={FIELD_BOX}>
            <select
              id="hero-city"
              value={ville}
              onChange={(e) => onCityChange(e.target.value)}
              className={FIELD_SELECT}
            >
              {/* A city typed in the box that the list leaves out (Likasi…)
                  is still shown as the city searched. */}
              {(CITY_OPTIONS.includes(ville) ? CITY_OPTIONS : [...CITY_OPTIONS, ville]).map((name) => (
                <option key={name} value={name}>{name === ALL_CITIES ? t('home.search.allCities') : name}</option>
              ))}
            </select>
            <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
          </div>
        </div>

        <div className={`col-span-2 min-w-0 ${spanTop}`}>
          <label htmlFor="hero-location" className={compact ? 'max-sm:sr-only ' + FIELD_LABEL : FIELD_LABEL}>
            {t('home.search.locationLabel')}
          </label>
          <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
          <LocationAutocomplete
            // Remounts on tab change so a stray typed value doesn't linger
            // from one transaction context into another.
            key={homeTab}
            ref={locationRef}
            id="hero-location"
            variant="hero"
            ariaLabel={t('home.search.locationLabel')}
            placeholder={compact ? t('appShell.home.searchPlaceholder') : t('home.search.heroPlaceholder')}
            extraParams={extraParams}
            onValueChange={onLocationChange}
            // The CTA is a full-width button on its own tier below, so this
            // renders no button of its own and is submitted through the ref.
            showButton={false}
            className={FIELD_BOX}
            rowClassName="flex w-full min-w-0 items-center gap-2.5"
            inputClassName="min-w-0 flex-1 bg-transparent py-3 text-[0.9375rem] text-ink placeholder:text-ink-35 focus:outline-none"
          />
          </div>
          {compact ? criteriaButton : null}
          </div>
        </div>

        {isShortStay ? (
          <p className="col-span-2 -mt-1 text-[0.875rem] text-ink-45">{t('home.search.shortHint')}</p>
        ) : (
          <>
            {/* Full width on a phone: the budget below needs both columns
                for its Min | Max pair. */}
            <div className={`col-span-2 min-w-0 ${spanTop} ${folded}`}>
              <label htmlFor="hero-type" className={FIELD_LABEL}>
                {t('home.search.propertyType')}
              </label>
              <div className={FIELD_BOX}>
                <select
                  id="hero-type"
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                  // `appearance-none` drops the native arrow on every engine
                  // so the single lucide chevron below is the only indicator.
                  className={FIELD_SELECT}
                >
                  <option value="">{t('home.search.allTypes')}</option>
                  {(() => {
                    // Homes, then offices / shops / warehouses under their own
                    // heading, so commercial space reads as a section of the
                    // catalogue rather than three odd entries in a list of homes.
                    const { residential, commercial } = groupTypeFacets(propertyTypes);
                    const option = (facet) => (
                      <option key={facet.value} value={facet.value}>
                        {facetLabel(facet, t)} ({facet.count})
                      </option>
                    );
                    if (!commercial.length) return residential.map(option);
                    return (
                      <>
                        {residential.length ? <optgroup label={t('listings.commercial.group.residential')}>{residential.map(option)}</optgroup> : null}
                        <optgroup label={t('listings.commercial.group.commercial')}>{commercial.map(option)}</optgroup>
                      </>
                    );
                  })()}
                </select>
                <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
              </div>
            </div>

            {bedsShown ? (
              <div id="hero-beds" role="group" aria-labelledby="hero-beds-label" className={`col-span-2 min-w-0 ${spanPair} ${folded}`}>
                <span id="hero-beds-label" className={FIELD_LABEL}>
                  {t('home.search.bedrooms')}
                </span>
                {/* Min | Max, the budget pair's shape: one select each. */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'hero-beds-min', aria: 'home.search.bedsMinAria', value: bedsMin, set: setBedsMin, options: bedSelects.minOptions },
                    { id: 'hero-beds-max', aria: 'home.search.bedsMaxAria', value: bedsMax, set: setBedsMax, options: bedSelects.maxOptions },
                  ].map(({ id, aria, value, set, options }) => (
                    <div key={id} className={FIELD_BOX}>
                      <select id={id} aria-label={t(aria)} value={value} onChange={(e) => set(e.target.value)} className={FIELD_SELECT}>
                        {options.map(({ value: optionValue, label, disabled }) => (
                          <option key={optionValue} value={optionValue} disabled={disabled}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div role="group" aria-labelledby="hero-budget-label" className={`col-span-2 min-w-0 ${spanPair} ${folded}`}>
              <span id="hero-budget-label" className={FIELD_LABEL}>
                {t('home.search.budgetLabel')}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className={FIELD_BOX}>
                  <select
                    id="hero-budget-min"
                    aria-label={t('home.search.budgetMinAria')}
                    value={budgetMin}
                    onChange={(e) => setBudgetMin(e.target.value)}
                    className={FIELD_SELECT}
                  >
                    {minOptions.map(({ value, label, disabled }) => (
                      <option key={value} value={value} disabled={disabled}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
                </div>
                <div className={FIELD_BOX}>
                  <select
                    id="hero-budget-max"
                    aria-label={t('home.search.budgetMaxAria')}
                    value={budgetMax}
                    onChange={(e) => setBudgetMax(e.target.value)}
                    className={FIELD_SELECT}
                  >
                    {maxOptions.map(({ value, label, disabled }) => (
                      <option key={value} value={value} disabled={disabled}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Phones only (see `moreOpen`). */}
      {compact ? null : <button
        type="button"
        aria-expanded={moreOpen}
        aria-controls={`hero-city hero-type${bedsShown ? ' hero-beds-min hero-beds-max' : ''} hero-budget-min hero-budget-max`}
        onClick={() => setMoreOpen((open) => !open)}
        className="u-press mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-[0.9375rem] font-semibold text-blue-deep sm:hidden"
      >
        <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4" />
        {moreOpen ? t('home.search.fewerCriteria') : t('home.search.moreCriteria')}
        {!moreOpen && foldedActive > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-deep px-1.5 text-[0.75rem] font-bold text-white">
            {foldedActive}
          </span>
        ) : null}
      </button>}

      {understood.length > 0 ? (
        <p className="u-reveal mt-3 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-ink-45" aria-live="polite">
          {t('home.search.understood')}
          {understood.map(({ key, label }) => (
            <span key={key} className="inline-flex h-6 items-center rounded-full bg-ink px-2.5 text-[0.75rem] font-bold text-white">
              {label}
            </span>
          ))}
        </p>
      ) : null}

      {/* --- 3. Primary CTA ----------------------------------------------- */}
      <button
        type="button"
        onClick={submit}
        className="u-press u-btn-primary mt-3 inline-flex h-12 w-full sm:mt-4 sm:h-[3.25rem] lg:h-12 2xl:h-[3.25rem] items-center justify-center rounded-xl bg-blue-deep px-6 text-[1.0625rem] font-bold text-white"
      >
        {/* Always mounted, so the live region exists before its text does —
            a region that appears at the same moment as its content is not
            reliably announced. */}
        <span className="u-tabular" aria-live="polite">
          {ctaLabel}
        </span>
      </button>
      {alertQuery ? (
        <QueryAlertButton
          query={alertQuery}
          label={t('home.search.alertMe')}
          entry="home_hero"
          variant="secondary"
          fullWidth
          className="mt-2"
        />
      ) : null}

      {/* --- 4. Quick pills ------------------------------------------------ */}
      {communes.length > 0 && !compact ? (
        <div className="mt-4 sm:mt-5">
          <span id="hero-quick-communes" className="u-eyebrow mb-2 block">
            {t('home.search.popularCommunes')}
          </span>
          {/* -mx-4/px-4 lets the row bleed to the card's true edge, while
              overflow-x-auto + no-scrollbar keeps the swipe contained to this
              row — no page-level horizontal overflow. */}
          <div
            role="group"
            aria-labelledby="hero-quick-communes"
            className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5"
          >
            {communes.map(({ commune }) => {
              const on = normalizedLocation === commune.trim().toLowerCase();
              return (
                <button
                  key={commune}
                  type="button"
                  aria-pressed={on}
                  onClick={() => applyCommune(commune)}
                  className={`u-press flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[0.9375rem] transition-colors lg:px-3.5 lg:text-sm lg:pointer-fine:min-h-9 2xl:px-4 2xl:text-[0.9375rem] 2xl:pointer-fine:min-h-11 ${
                    on
                      ? 'border-blue bg-blue-tint font-semibold text-blue-deep'
                      : 'border-ink-25 bg-surface font-medium text-ink hover:border-ink-45'
                  }`}
                >
                  {commune}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
