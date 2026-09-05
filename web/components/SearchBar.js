'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, ChevronDown, Building2, Wallet } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import { HERO_DEFAULT_TAB, HERO_TRANSACTION_BY_TAB, ICON_STROKE_WIDTH } from '@/lib/constants';
import { parseSearchQuery } from '@/lib/searchParser';

/**
 * The hero search panel — a white card floating over the hero photograph,
 * in four explicit tiers, top to bottom:
 *
 *   1. a segmented Louer / Acheter pill toggle
 *   2. ONE field block with hairline dividers: location on its own row,
 *      then Type de bien | Budget max side by side — a 2-column grid at
 *      every width, phones included, not a mobile stack
 *   3. the primary Rechercher CTA, full width on mobile, carrying the real
 *      live result count for whatever is currently staged
 *   4. a scrollable row of commune quick-pills that fill the location field
 *      in one tap
 *
 * WHY THE FIELDS ARE FUSED INTO ONE BLOCK: they were three separate
 * bordered boxes in a `sm:flex-row` with visible labels above each. That
 * reads as a form to complete before anything happens. Fusing them into a
 * single divided block (the pattern Airbnb/Booking/Zillow all converged
 * on) makes the whole thing read as one control with one action, which is
 * what a hero search is. The visible labels are gone with it — every field
 * carries its icon + placeholder, and the accessible name survives on
 * `aria-label`, so nothing is lost to a screen reader.
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
  { value: 'louer', label: 'Louer' },
  { value: 'acheter', label: 'Acheter' },
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

const BUDGET_MAX_OPTIONS = [
  { value: '', label: 'Tous prix' },
  ...PRICE_STEP_VALUES.map((amount) => ({
    value: String(amount),
    // "Max X" throughout, the last step included. "5 000 $ et +" would be
    // a lie in a *ceiling* field — it reads as a floor — and the longer
    // "Jusqu'à X $" does not survive the 2-column cell at 320px, where a
    // native <select> shows the selected option's own text verbatim.
    label: `Max ${amount.toLocaleString('fr-FR')} $`,
  })),
];

const COUNT_DEBOUNCE_MS = 350;

/** "31 biens" / "1 bien" / "0 bien" — French takes the singular at zero. */
function formatCount(n) {
  return `${n.toLocaleString('fr-FR')} bien${n > 1 ? 's' : ''}`;
}

/**
 * One row inside the fused field block. `focus-within` paints the whole
 * row, not just the input, so the active section is what highlights — and
 * it does it with an INSET ring rather than an outer `box-shadow`, because
 * the block is `overflow-hidden` (that's what clips the dividers to the
 * rounded corners) and an outer ring would be sliced off at the block's
 * own edge.
 */
const ROW_BASE =
  'relative flex min-h-12 min-w-0 items-center gap-2.5 bg-transparent px-3.5 transition-colors ' +
  'focus-within:z-10 focus-within:bg-surface focus-within:shadow-[inset_0_0_0_2px_var(--blue)]';

/**
 * The two paired cells split the width the location row gets to itself, so
 * they are the ones with a real width budget — and it was measured in a
 * browser at 320px, not estimated. Two things came out of it:
 *
 *   - Below `sm` the cells shed their leading icon and tighten to 10px
 *     padding / 6px gaps / 14px type. With the icon in, the select gets
 *     ~45px of a 320px viewport and every label clips to "Tou…"; without
 *     it, ~84px, which fits everything at rest and most selected values.
 *     A whole label and no icon beats an icon and no label.
 *   - The resting labels are "Tous types" / "Tous prix". "Tous budgets"
 *     was the first wording and needs 91px against that 84px — it clipped
 *     to "Tous budget…" on the narrowest phones.
 *
 * A long SELECTED value ("Appartement (27)") still truncates on a ~375px
 * phone. That is inherent to two dropdowns side by side at that width,
 * which is the layout that was asked for, and it is the acceptable half of
 * the trade: the visitor just chose that option, where the resting labels
 * are what everyone reads. A native <select> renders the chosen option's
 * own text, so an option list's copy IS the closed control's copy — which
 * is also why the steps are "Max 1 500 $" rather than "Jusqu'à 1 500 $".
 */
const CELL_BASE =
  'relative flex min-h-12 min-w-0 items-center gap-1.5 bg-transparent px-2.5 transition-colors ' +
  'focus-within:z-10 focus-within:bg-surface focus-within:shadow-[inset_0_0_0_2px_var(--blue)] ' +
  'sm:gap-2.5 sm:px-3.5';

const CELL_ICON = 'hidden h-4 w-4 shrink-0 text-ink-45 sm:block';

const CELL_SELECT =
  'min-w-0 flex-1 cursor-pointer truncate appearance-none bg-transparent py-3 text-[0.875rem] ' +
  'font-medium text-ink focus:outline-none sm:pr-1 sm:text-[0.9375rem]';

export default function SearchBar({ propertyTypes = [], communes = [], initialCount = null }) {
  const [homeTab, setHomeTab] = useState(HERO_DEFAULT_TAB);
  const [propertyType, setPropertyType] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  // Mirrors the location field's text. LocationAutocomplete still owns the
  // input itself; this is the copy the quick-pill tint and the live count
  // read, kept in step through its `onValueChange`/`setQuery` pair.
  const [location, setLocation] = useState('');
  const locationRef = useRef(null);

  const transactionType = HERO_TRANSACTION_BY_TAB[homeTab] || '';

  const extraParams = {
    transaction_type: transactionType,
    property_type: propertyType,
    price_max: budgetMax,
  };

  // A pill is lit only while the field literally still holds that commune's
  // name — see LocationAutocomplete's `onValueChange` note. Comparison is
  // trimmed + case-insensitive so "gombe " still counts as Gombe.
  const normalizedLocation = location.trim().toLowerCase();

  // ---- Live result count -------------------------------------------------
  // Real `/api/listings/count` (the same endpoint FilterBar's Prix popover
  // uses — same parseListingsSearchParams, same getListings, same approved
  // filter), never a client-side guess. `initialCount` is the server's own
  // unfiltered total so the button ships with a real number in its first
  // paint instead of flashing a placeholder.
  const [count, setCount] = useState(initialCount);
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
      if (propertyType) qs.set('property_type', propertyType);
      if (budgetMax) qs.set('price_max', budgetMax);

      // Parsed exactly the way submitting parses it (LocationAutocomplete's
      // submitFreeText -> applyParsedFilters), and in the same precedence:
      // what was typed wins over the selects, so the count describes the
      // page the button actually navigates to rather than a different set
      // of filters that happen to be easier to assemble here.
      const parsed = parseSearchQuery(location);
      if (parsed.reference) qs.set('reference', parsed.reference);
      if (parsed.transaction_type) qs.set('transaction_type', parsed.transaction_type);
      if (parsed.price_min != null) qs.set('price_min', String(parsed.price_min));
      if (parsed.price_max != null) qs.set('price_max', String(parsed.price_max));
      if (parsed.beds_min != null) qs.set('beds_min', String(parsed.beds_min));
      if (parsed.bath_min != null) qs.set('bath_min', String(parsed.bath_min));
      if (parsed.property_type) {
        qs.set('property_type', parsed.property_type);
        if (parsed.parcelle_subtype) qs.set('parcelle_subtype', parsed.parcelle_subtype);
      }
      if (parsed.commune) {
        qs.set('commune', parsed.commune);
        if (parsed.quartier) qs.set('quartier', parsed.quartier);
      }
      if (parsed.keywords) qs.set('q', parsed.keywords);

      fetch(`/api/listings/count?${qs.toString()}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((json) => {
          if (typeof json.total === 'number') setCount(json.total);
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
  }, [transactionType, propertyType, budgetMax, location]);

  function applyCommune(name) {
    // Tapping the lit pill clears it — a one-tap filter needs a one-tap
    // undo, otherwise the only way out of a chip is to select its text.
    const next = normalizedLocation === name.trim().toLowerCase() ? '' : name;
    locationRef.current?.setQuery(next);
  }

  function submit() {
    locationRef.current?.submit();
  }

  return (
    // Solid white over the photo, not the frosted `bg-surface/90` this
    // carried before: the fused field block below is itself a tinted
    // sunken surface, and that figure/ground reading needs an opaque card
    // behind it — through 10% of a photograph it just muddies.
    <div className="overflow-hidden rounded-3xl border border-line bg-surface p-4 u-shadow-panel sm:p-5">
      {/* --- 1. Intent toggle ------------------------------------------- */}
      <div
        role="tablist"
        aria-label="Type de transaction"
        className="mb-4 inline-flex rounded-full bg-canvas-alt p-1"
      >
        {HOME_TABS.map(({ value, label }) => {
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
              // cleared by hand. Caught in a browser, not by a test: the
              // pill stayed lit and the live count kept filtering on a
              // commune the now-empty field no longer held.
              onClick={() => {
                setHomeTab(value);
                setLocation('');
              }}
              // 48px, not the 44px a segmented control usually gets: the
              // brief sets one floor for every interactive control in this
              // panel and the toggle is no exception.
              className={`u-press min-h-12 rounded-full px-6 text-[0.9375rem] font-semibold transition-colors ${
                on
                  ? 'bg-surface text-blue-deep shadow-[var(--shadow-card)]'
                  : 'text-ink-45 hover:text-ink'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* --- 2. Fused field block ---------------------------------------- */}
      {/* `overflow-hidden` is what clips the dividers into the rounded
          corners; every row inside compensates with an inset focus ring
          (ROW_BASE) so nothing focus-related gets sliced by it. */}
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-ink-25 bg-canvas-alt/60">
        <LocationAutocomplete
          // Remounts on tab change so a stray typed value doesn't linger
          // from one transaction context into another.
          key={homeTab}
          ref={locationRef}
          id="hero-location"
          variant="hero"
          ariaLabel="Commune, quartier ou référence"
          placeholder="Commune / Quartier (ex : Gombe, Ngaliema)"
          extraParams={extraParams}
          onValueChange={setLocation}
          // The CTA is a full-width button on its own tier below, so this
          // renders no button of its own and is submitted through the ref.
          showButton={false}
          // LocationAutocomplete paints its leading icon `text-ink-25`,
          // which the token file reserves for "placeholder, disabled —
          // decorative only". Next to the two ink-45 icons on the row
          // below it reads as a rendering fault rather than a lighter
          // weight, so it's lifted to match — scoped to this instance
          // rather than changed in the shared component, which FilterBar
          // also renders.
          className={`${ROW_BASE} [&_svg]:text-ink-45`}
          rowClassName="flex w-full min-w-0 items-center gap-2.5"
          inputClassName="min-w-0 flex-1 bg-transparent py-3 text-[0.9375rem] text-ink placeholder:text-ink-35 focus:outline-none"
          icon={MapPin}
          showIcon
        />

        {/* Two columns at EVERY width — the brief is explicit that these
            sit side by side on mobile too, not stacked. `min-w-0` on both
            cells plus `truncate` on the select is what keeps a long
            selected label ("Appartement (27)") clipping inside its cell
            instead of forcing the grid — and the page — wider than a
            320px viewport. */}
        <div className="grid grid-cols-2 divide-x divide-line">
          <div className={CELL_BASE}>
            <Building2 strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className={CELL_ICON} />
            <select
              id="hero-type"
              aria-label="Type de bien"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              // `appearance-none` drops the native arrow on every engine
              // so the single lucide chevron below is the only indicator.
              className={CELL_SELECT}
            >
              <option value="">Tous types</option>
              {propertyTypes.map(({ value, label, count: typeCount }) => (
                <option key={value} value={value}>
                  {label} ({typeCount})
                </option>
              ))}
            </select>
            <ChevronDown
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
              className="pointer-events-none h-4 w-4 shrink-0 text-ink-45"
            />
          </div>

          <div className={CELL_BASE}>
            <Wallet strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className={CELL_ICON} />
            <select
              id="hero-budget"
              aria-label="Budget maximum"
              value={budgetMax}
              onChange={(e) => setBudgetMax(e.target.value)}
              className={CELL_SELECT}
            >
              {BUDGET_MAX_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
              className="pointer-events-none h-4 w-4 shrink-0 text-ink-45"
            />
          </div>
        </div>
      </div>

      {/* --- 3. Primary CTA ----------------------------------------------- */}
      <button
        type="button"
        onClick={submit}
        className="u-press u-btn-primary mt-4 inline-flex h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl bg-blue px-6 text-[1rem] font-semibold text-white"
      >
        <Search strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
        <span>Rechercher</span>
        {/* Always mounted, so the live region exists before its text does —
            a region that appears at the same moment as its content is not
            reliably announced. */}
        <span className="u-tabular font-medium text-white/80" aria-live="polite">
          {count != null ? `(${formatCount(count)})` : ''}
        </span>
      </button>

      {/* --- 4. Quick pills ------------------------------------------------ */}
      {communes.length > 0 ? (
        <div className="mt-4">
          <span id="hero-quick-communes" className="u-eyebrow mb-2 block">
            Communes populaires
          </span>
          {/* -mx-4/px-4 lets the row bleed to the card's true edge so the
              first/last chip isn't visually inset, while overflow-x-auto +
              no-scrollbar keeps the swipe contained to this row — no
              page-level horizontal overflow, which is the <375px
              requirement. */}
          <div
            role="group"
            aria-labelledby="hero-quick-communes"
            className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-5 sm:px-5"
          >
            {communes.map(({ commune, count: communeCount }) => {
              const on = normalizedLocation === commune.trim().toLowerCase();
              return (
                <button
                  key={commune}
                  type="button"
                  aria-pressed={on}
                  onClick={() => applyCommune(commune)}
                  className={`u-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[0.8125rem] transition-colors ${
                    on
                      ? 'border-blue bg-blue-tint font-semibold text-blue-deep'
                      : 'border-transparent bg-canvas-alt font-medium text-ink-70 hover:bg-canvas-deep'
                  }`}
                >
                  <MapPin
                    strokeWidth={ICON_STROKE_WIDTH}
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  {commune}
                  {/* The real approved-listing count, same figure the
                      commune row carried before this — never decorative. */}
                  <span className={`u-tabular ${on ? 'text-blue' : 'text-ink-35'}`}>
                    {communeCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
