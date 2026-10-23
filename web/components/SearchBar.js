'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import { HERO_DEFAULT_TAB, HERO_TRANSACTION_BY_TAB, ICON_STROKE_WIDTH } from '@/lib/constants';
import { parseSearchQuery } from '@/lib/searchParser';
import { understoodChips } from '@/lib/searchUnderstood';
import { useT } from '@/lib/i18n/client';
import { facetLabel, groupTypeFacets } from '@/lib/commercialSpaces';

/**
 * The hero search panel — a white card floating over the hero photograph,
 * in four tiers, top to bottom (2026-10-23 redesign, from the owner's
 * mock-ups):
 *
 *   1. a segmented Louer / Courte durée / Acheter toggle
 *   2. labelled boxes: "Lieu" on its own row (a city, commune or quartier —
 *      lib/searchParser.js reads the city out of the text, which is why the
 *      separate "Ville" select is gone), then Type de bien | Budget side by
 *      side. Courte durée shows a one-line explanation instead of the pair.
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
 * BUDGET IS A CEILING AGAIN. This field was a min/max Popover; the brief
 * asks for a single "Budget max" dropdown and that's what it is now. A
 * price *floor* is not lost — FilterBar's own Prix pill on /listings still
 * offers min and max, which is where someone refines rather than starts.
 * A plain native `<select>` is safe here in a way it was not inside that
 * Popover: the documented iOS Safari misplacement came from Radix's
 * Popper applying a CSS `transform` to the panel, and nothing on this
 * card's ancestor chain carries one.
 *
 * `propertyTypes` and `communes` are both real and DB-derived
 * (`getPropertyTypeFacets()` / `getPopularCommunes()`, from the homepage's
 * own server component), so neither the type dropdown nor a quick-pill
 * ever offers something with zero results behind it. `BUDGET_MAX_OPTIONS`
 * is a small fixed set of round steps — a filter-UI convenience, not a
 * claim about the data — feeding the same `price_max` param FilterBar
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

// Tiered steps, not one flat increment across the whole range: renters
// under $1,000 are genuinely sensitive to $100-200 gaps ($700 vs $800 is a
// real different bracket of listing), where $2k+ listings don't need that
// resolution — a single $500 step for the whole scale either buries the
// low end in too-coarse buckets or makes the high end an unusably long
// list. 100-1 000 by 100, 1 250-2 000 by 250, 2 500-5 000 by 500.
const PRICE_STEP_VALUES = [
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100), // 100, 200, ..., 1 000
  1250, 1500, 1750, 2000,
  2500, 3000, 3500, 4000, 4500, 5000,
];

/*
 * Built per-render now rather than as a module constant, because both the
 * label AND the thousands separator are language-dependent ("Max 1 500 $" vs
 * "Max $1,500"). The 24-entry array is cheap to rebuild and is memoised at
 * the call site; a module-level constant would freeze both in French.
 */
function buildBudgetMaxOptions(t) {
  const numberLocale = t.locale === 'en' ? 'en-GB' : 'fr-FR';
  return [
    { value: '', label: t('home.search.allPrices') },
    ...PRICE_STEP_VALUES.map((amount) => ({
      value: String(amount),
      // "Max X" throughout, the last step included. "5 000 $ et +" would be
      // a lie in a *ceiling* field — it reads as a floor — and the longer
      // "Jusqu'à X $" does not survive the 2-column cell at 320px, where a
      // native <select> shows the selected option's own text verbatim.
      label: t('home.search.budgetMax', { amount: amount.toLocaleString(numberLocale) }),
    })),
  ];
}

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
  // Rebuilt only when the language changes — see buildBudgetMaxOptions.
  const budgetMaxOptions = useMemo(() => buildBudgetMaxOptions(t), [t]);
  const [homeTab, setHomeTab] = useState(HERO_DEFAULT_TAB);
  const [propertyType, setPropertyType] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
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
  const stagedBudget = isShortStay ? '' : budgetMax;

  const extraParams = {
    transaction_type: transactionType,
    property_type: stagedType,
    price_max: stagedBudget,
    lease_term: leaseTerm,
  };

  // A pill is lit only while the field literally still holds that commune's
  // name — see LocationAutocomplete's `onValueChange` note. Comparison is
  // trimmed + case-insensitive so "gombe " still counts as Gombe.
  const normalizedLocation = location.trim().toLowerCase();

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
      if (stagedBudget) qs.set('price_max', stagedBudget);
      if (leaseTerm) qs.set('lease_term', leaseTerm);

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
  }, [transactionType, stagedType, stagedBudget, leaseTerm, location]);

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

  // The button wording follows the mock-ups: the live count on Louer, a
  // fixed call to action on the other two tabs. A zero-result search still
  // says what it will really show (suggestions) on every tab.
  let ctaLabel;
  if (count === 0 && suggested > 0) ctaLabel = t('home.search.seeSuggestions', { count: suggested });
  else if (homeTab === 'acheter') ctaLabel = t('home.search.seeForSale');
  else if (isShortStay) ctaLabel = t('home.search.seeShortStays');
  else if (count != null && count > 0) ctaLabel = t('home.search.seeCount', { count });
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
                setHomeTab(value);
                setLocation('');
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
      <div className={`grid grid-cols-2 gap-x-3 gap-y-4 ${isShortStay ? '' : 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]'}`}>
        <div className="col-span-2 lg:col-span-1">
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
            onValueChange={setLocation}
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
            <div className="min-w-0">
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

            <div className="min-w-0">
              <label htmlFor="hero-budget" className={FIELD_LABEL}>
                {t('home.search.budgetLabel')}
              </label>
              <div className={FIELD_BOX}>
                <select
                  id="hero-budget"
                  aria-label={t('home.search.budget')}
                  value={budgetMax}
                  onChange={(e) => setBudgetMax(e.target.value)}
                  className={FIELD_SELECT}
                >
                  {budgetMaxOptions.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
              </div>
            </div>
          </>
        )}
      </div>

      {understood.length > 0 ? (
        <p className="u-reveal mt-3 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-ink-45" aria-live="polite">
          {t('home.search.understood')}
          {understood.map((chip) => (
            <span key={chip.key} className="inline-flex h-6 items-center rounded-full bg-ink px-2.5 text-[0.75rem] font-bold text-white">
              {chip.label}
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
