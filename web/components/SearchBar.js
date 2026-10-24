'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import { HERO_DEFAULT_TAB, HERO_TRANSACTION_BY_TAB, ICON_STROKE_WIDTH } from '@/lib/constants';
import { parseSearchQuery } from '@/lib/searchParser';
import { understoodChips } from '@/lib/searchUnderstood';
import { useT } from '@/lib/i18n/client';
import { facetLabel, groupTypeFacets } from '@/lib/commercialSpaces';
import { budgetOptions, budgetParams } from '@/lib/budgetSteps';
import { frNumber } from '@/lib/format';
import { CITIES, DEFAULT_CITY, cityOfCommune } from '@/lib/cities';

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
function budgetLabels(t) {
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

// Kinshasa first, then alphabetical. There is no "Toutes les villes": a
// search with no city runs in Kinshasa (lib/listings.js, searchCityOf), so
// that option would have shown Kinshasa only under another name.
const CITY_OPTIONS = [...CITIES]
  .map((city) => city.name)
  .sort((a, b) => (a === DEFAULT_CITY ? -1 : b === DEFAULT_CITY ? 1 : a.localeCompare(b, 'fr')));

const COUNT_DEBOUNCE_MS = 350;


/*
 * Separate labelled boxes (2026-10-23 redesign), not the fused divided block
 * this used to be: a visible label above each box and no leading icons, so on
 * a 375px phone both selects get their whole width. A native <select> shows
 * the chosen option's own text, which is why the budget steps read
 * "Max 1 500 $" — short enough for a half-width box.
 */
const FIELD_BOX =
  'relative flex min-h-[3.25rem] min-w-0 items-center gap-2 rounded-xl border border-ink-25 bg-surface px-4 transition-colors ' +
  'focus-within:border-blue focus-within:shadow-[0_0_0_3px_var(--blue-tint)]';

const FIELD_LABEL = 'mb-2 block text-[0.9375rem] font-bold text-ink';

const FIELD_SELECT =
  'min-w-0 flex-1 cursor-pointer truncate appearance-none bg-transparent py-3 text-[0.9375rem] ' +
  'text-ink focus:outline-none';

export default function SearchBar({ propertyTypes = [], communes = [], initialCount = null }) {
  const t = useT();
  const [homeTab, setHomeTab] = useState(HERO_DEFAULT_TAB);
  const [propertyType, setPropertyType] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  // The city searched (?ville=). A city, or another city's commune, typed in
  // the box wins over it (lib/searchParser.js), and the select follows it.
  const [ville, setVille] = useState(DEFAULT_CITY);
  // Mirrors the location field's text. LocationAutocomplete still owns the
  // input itself; this is the copy the quick-pill tint and the live count
  // read, kept in step through its `onValueChange`/`setQuery` pair.
  const [location, setLocation] = useState('');
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
    const parsed = parseSearchQuery(text);
    if (parsed.ville) return parsed.ville;
    return parsed.commune ? cityOfCommune(parsed.commune) || DEFAULT_CITY : null;
  }

  function onLocationChange(text) {
    setLocation(text);
    const city = cityOfText(text);
    if (city) setVille(city);
  }

  // Picking another city clears a place of a different city from the box,
  // so the select and the text never point at two cities.
  function onCityChange(next) {
    setVille(next);
    const typed = cityOfText(location);
    if (next && typed && typed !== next) locationRef.current?.setQuery('');
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

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const qs = new URLSearchParams();
      if (transactionType) qs.set('transaction_type', transactionType);
      if (stagedType) qs.set('property_type', stagedType);
      if (stagedMin) qs.set('price_min', stagedMin);
      if (stagedMax) qs.set('price_max', stagedMax);
      if (leaseTerm) qs.set('lease_term', leaseTerm);
      if (ville) qs.set('ville', ville);

      // Parsed exactly the way submitting parses it (LocationAutocomplete's
      // submitFreeText -> applyParsedFilters), and in the same precedence:
      // what was typed wins over the selects, so the count describes the
      // page the button actually navigates to.
      const parsed = parseSearchQuery(location);
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
  }, [transactionType, stagedType, stagedMin, stagedMax, leaseTerm, ville, location]);

  // What the parser takes from the typed text, read back as chips — so a
  // visitor sees that "Gombe" and "2 chambres" were understood before they
  // search. Never a filter of its own (lib/searchUnderstood.js).
  const understood = useMemo(
    () => (location.trim().length >= 3 ? understoodChips(parseSearchQuery(location), t) : []),
    [location, t],
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
  let ctaLabel;
  if (count === 0 && suggested > 0) ctaLabel = t('home.search.seeSuggestions', { count: suggested });
  else if (count != null && count > 0) ctaLabel = t('home.search.seeCount', { count });
  else if (homeTab === 'acheter') ctaLabel = t('home.search.seeForSale');
  else if (isShortStay) ctaLabel = t('home.search.seeShortStays');
  else ctaLabel = t('home.search.submit');

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-surface p-4 u-shadow-panel sm:p-5">
      {/* --- 1. Intent toggle ------------------------------------------- */}
      <div
        role="tablist"
        aria-label={t('home.search.transactionType')}
        // Widths follow the labels (flex-auto), not three equal columns:
        // "Courte durée" does not fit a third of a 375px card.
        className="mb-5 flex w-full gap-1 rounded-2xl bg-canvas-alt p-1 sm:inline-flex sm:w-auto"
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
              className={`u-press min-h-12 flex-auto whitespace-nowrap rounded-xl px-3 text-[0.9375rem] font-semibold transition-colors sm:px-6 ${
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
      <div className={`grid grid-cols-2 gap-x-3 gap-y-4 ${isShortStay ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)]'}`}>
        <div className="col-span-2 min-w-0 lg:col-span-1">
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
              {CITY_OPTIONS.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
          </div>
        </div>

        <div className="col-span-2 min-w-0 lg:col-span-1">
          <label htmlFor="hero-location" className={FIELD_LABEL}>
            {t('home.search.locationLabel')}
          </label>
          <LocationAutocomplete
            // Remounts on tab change so a stray typed value doesn't linger
            // from one transaction context into another.
            key={homeTab}
            ref={locationRef}
            id="hero-location"
            variant="hero"
            ariaLabel={t('home.search.locationLabel')}
            placeholder={t('home.search.heroPlaceholder')}
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

        {isShortStay ? (
          <p className="col-span-2 -mt-1 text-[0.875rem] text-ink-45">{t('home.search.shortHint')}</p>
        ) : (
          <>
            {/* Full width on a phone: the budget below needs both columns
                for its Min | Max pair. */}
            <div className="col-span-2 min-w-0 lg:col-span-1">
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

            <div role="group" aria-labelledby="hero-budget-label" className="col-span-2 min-w-0 lg:col-span-1">
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
        className="u-press u-btn-primary mt-5 inline-flex h-14 w-full items-center justify-center rounded-xl bg-blue-deep px-6 text-[1.0625rem] font-bold text-white"
      >
        {/* Always mounted, so the live region exists before its text does —
            a region that appears at the same moment as its content is not
            reliably announced. */}
        <span className="u-tabular" aria-live="polite">
          {ctaLabel}
        </span>
      </button>

      {/* --- 4. Quick pills ------------------------------------------------ */}
      {communes.length > 0 ? (
        <div className="mt-5">
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
                  className={`u-press flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[0.9375rem] transition-colors ${
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
