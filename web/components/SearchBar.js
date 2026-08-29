'use client';

import { useRef, useState } from 'react';
import { Search, MapPin, ChevronDown } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The hero search panel — web/Design's SearchPanel
 * (components/property/SearchPanel.jsx), rendered at full container width.
 *
 * Two parts, in the design's order:
 *   1. an underline Tabs row (Louer / Acheter) — the design's own
 *      `searchTabs`, with a 3px royal-600 underline on the active tab over
 *      a 1px hairline, not the rounded pill group this used before.
 *      Parcelles is still reachable via the "Type de bien" select.
 *   2. a labelled field row: location (flex 2), Type de bien (flex 1),
 *      Budget (flex 1, a Zoopla-style min/max popover), and a 56px primary
 *      Rechercher button
 *
 * Two things the refonte removed from this panel, both because they put a
 * second primary action inside the one unit that already has "Rechercher":
 *   - An "Agents" tab. A directory is not a property type, so a tab that
 *     changes the entity rather than the search broke the row's own
 *     pattern; agencies moved up into the top nav (Header.js).
 *   - A fused royal-700 "list your property" strip. It competed with
 *     Rechercher and pushed the listings ~140px further down the page; the
 *     same cross-sell now has its own royal band above the footer
 *     (Footer.js), which is where the partner ask lives.
 *
 * Fields carry visible labels above them ("Commune, quartier ou référence",
 * "Type de bien", "Budget") because the design's Input/Select do; the
 * previous version was placeholder-only.
 *
 * Tab behaviour: Louer/Acheter set transaction_type.
 *
 * `propertyTypes` is real and DB-derived (getPropertyTypeFacets(), the same
 * source FilterBar's own pill uses), so a type with zero results is never
 * offered. `BUDGET_MIN_OPTIONS`/`BUDGET_MAX_OPTIONS` are a small fixed set
 * of round steps — a filter-UI convenience, not a claim about the data —
 * feeding the same `price_min`/`price_max` params FilterBar's own Prix pill
 * already submits on /listings.
 *
 * Placeholder copy stays "Gombe, Ma Campagne" per the design, and the label
 * says "référence" (never "repère") per the root CLAUDE.md.
 */
const HOME_TABS = [
  { value: 'louer', label: 'Louer' },
  { value: 'acheter', label: 'Acheter' },
];

const TRANSACTION_BY_TAB = { louer: 'location', acheter: 'vente' };

// Tiered steps, not one flat increment across the whole range: renters
// under $1,000 are genuinely sensitive to $100-200 gaps ($700 vs $800 is a
// real different bracket of listing), where $2k+ listings don't need that
// resolution — a single $500 step for the whole scale either buries the
// low end in too-coarse buckets or makes the high end an unusably long
// list. Computed once here rather than hand-typed twice (min and max share
// the exact same thresholds), so the three tier boundaries only exist in
// one place: 100-1 000 by 100, 1 250-2 000 by 250, 2 500-5 000 by 500.
const PRICE_STEP_VALUES = [
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 100), // 100, 200, ..., 1 000
  1250, 1500, 1750, 2000,
  2500, 3000, 3500, 4000, 4500, 5000,
];

function buildBudgetOptions(noneLabel) {
  const last = PRICE_STEP_VALUES.length - 1;
  return [
    { value: '', label: noneLabel },
    ...PRICE_STEP_VALUES.map((amount, i) => ({
      value: String(amount),
      label: i === last ? `${amount.toLocaleString('fr-FR')} $ et +` : `${amount.toLocaleString('fr-FR')} $`,
    })),
  ];
}

const BUDGET_MIN_OPTIONS = buildBudgetOptions('Sans min');
const BUDGET_MAX_OPTIONS = buildBudgetOptions('Sans max');

/**
 * Prix min/max option list inside the Budget popover — real buttons, not a
 * native `<select>`. Used to be one; confirmed as the real cause of a
 * dropdown that rendered its option list detached near the top of the
 * screen on iOS Safari rather than anchored under the field: Radix's own
 * Popper positioning (PopoverContent, see ui/popover.jsx) applies a real
 * CSS `transform` to place the panel, and WebKit's native `<select>`
 * picker miscalculates its own anchor position when any ancestor carries a
 * transform — a documented WebKit quirk, not something `appearance: none`
 * (already present before this and confirmed not sufficient — that only
 * restyles the closed control, it doesn't touch where the native picker
 * itself renders) fixes. A plain button list sidesteps the native picker
 * entirely, so there's nothing left for that WebKit behaviour to break.
 */
function BudgetOptionList({ idPrefix, label, options, value, onChange }) {
  return (
    <div>
      <span className="u-eyebrow mb-2 block" id={`${idPrefix}-label`}>
        {label}
      </span>
      {/* max-h-60 (240px) + overflow-y-auto: real necessity now, not
          decoration — the tiered price steps mean up to 21 rows per
          column (see PRICE_STEP_VALUES), which at ~36px each would run
          ~750px tall unconstrained, taller than most phone viewports and
          well past PopoverContent's own unbounded height. */}
      <div role="listbox" aria-labelledby={`${idPrefix}-label`} className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(opt.value)}
              className={`u-press w-full rounded-md px-2.5 py-2 text-left text-[0.8125rem] font-medium transition-colors ${
                selected ? 'bg-blue-tint text-blue-deep' : 'text-ink-70 hover:bg-canvas-alt'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatBudgetLabel(min, max) {
  const fmt = (v) => `${Number(v).toLocaleString('fr-FR')} $`;
  if (min && max) return `${fmt(min)} - ${fmt(max)}`;
  if (max) return `Max ${fmt(max)}`;
  if (min) return `Dès ${fmt(min)}`;
  return 'Tous les budgets';
}

/** The design's Input/Select shell at size lg: 8px radius, 1px inset
 *  hairline, 16/18px padding, with the label sitting above it. */
function Field({ label, htmlFor, className = '', children }) {
  return (
    <label htmlFor={htmlFor} className={`flex min-w-0 flex-col gap-2 ${className}`}>
      <span className="text-[0.875rem] font-bold text-ink">{label}</span>
      {children}
    </label>
  );
}

const FIELD_SHELL =
  'u-focus-ring flex items-center gap-3 rounded-lg border border-ink-25 bg-surface px-[1.125rem] py-4';

export default function SearchBar({ propertyTypes = [] }) {
  const [homeTab, setHomeTab] = useState('louer');
  const [propertyType, setPropertyType] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const locationRef = useRef(null);

  const extraParams = {
    transaction_type: TRANSACTION_BY_TAB[homeTab] || '',
    property_type: propertyType,
    price_min: budgetMin,
    price_max: budgetMax,
  };

  // border-line: a real hairline (the design's own --border-subtle), not a
  // frosted/translucent fill — the compiled SearchPanel.jsx source is
  // explicit that this panel is solid white + shadow-panel, and the
  // design's readme rules out a frosted card here specifically ("never a
  // dark frosted-glass card"). The border exists only to give the panel a
  // defined edge against a bright photo; shadow-panel still carries the
  // actual elevation.
  return (
    // Frosted glass over the photo, not a flat bg-surface: bg-surface/90 is
    // real --surface (#fff) at 90% opacity, close enough to opaque that
    // every text/input contrast combo inside is unaffected, but translucent
    // enough that backdrop-blur reads as glass against the hero photo it
    // straddles. border-white/30 replaces border-line here specifically —
    // the hairline border-line is tuned for a solid white card and all but
    // disappears against a photo; a soft white edge reads correctly on both
    // the photo (top of the panel) and the canvas background (bottom).
    <div className="overflow-hidden rounded-2xl border border-white/30 bg-surface/90 backdrop-blur-md u-shadow-panel">
      {/* Underline tabs — the design's Tabs default variant. */}
      <div role="tablist" className="flex gap-1 overflow-x-auto px-4 shadow-[0_-1px_0_var(--line)_inset]">
        {HOME_TABS.map(({ value, label }) => {
          const on = homeTab === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setHomeTab(value)}
              className={`shrink-0 whitespace-nowrap px-5 py-3.5 text-[1rem] font-semibold transition-colors ${
                on
                  ? 'text-blue-deep shadow-[0_-3px_0_var(--blue)_inset]'
                  : 'text-ink-45 hover:text-ink'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-stretch gap-3 p-6 sm:flex-row sm:items-end">
          <Field
            label="Commune, quartier ou référence"
            htmlFor="hero-location"
            className="sm:flex-[2_1_18.75rem]"
          >
            <LocationAutocomplete
              // Remounts on tab change so a stray typed value doesn't linger
              // from one transaction/type context into another.
              key={homeTab}
              ref={locationRef}
              id="hero-location"
              variant="hero"
              placeholder="Gombe, Ma Campagne"
              extraParams={extraParams}
              // The button lives at the end of the row, after the selects —
              // the design's field order — so this renders no button of
              // its own and is submitted through the ref instead.
              showButton={false}
              className={FIELD_SHELL}
              rowClassName="flex w-full items-center gap-3"
              inputClassName="min-w-0 flex-1 bg-transparent text-[1rem] text-ink placeholder:text-ink-25 focus:outline-none"
              icon={MapPin}
              showIcon
            />
          </Field>

          <Field label="Type de bien" htmlFor="hero-type" className="sm:flex-[1_1_10.625rem]">
            <div className={`${FIELD_SHELL} relative`}>
              <select
                id="hero-type"
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="min-w-0 flex-1 appearance-none bg-transparent text-[1rem] font-medium text-ink focus:outline-none"
              >
                <option value="">Tous les types</option>
                {propertyTypes.map(({ value, label, count }) => (
                  <option key={value} value={value}>
                    {label} ({count})
                  </option>
                ))}
              </select>
              <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="pointer-events-none h-4.5 w-4.5 shrink-0 text-ink-45" />
            </div>
          </Field>

          {/* Zoopla-style budget popover: a single trigger showing the
              current range, opening a two-column Prix min/Prix max panel —
              replaces the old single "Budget max" <select>, which could
              only ever express a ceiling, never a floor. */}
          <Field label="Budget" className="sm:flex-[1_1_10.625rem]">
            <Popover>
              <PopoverTrigger className={`${FIELD_SHELL} w-full justify-between text-left`}>
                <span className="min-w-0 flex-1 truncate text-[1rem] font-medium text-ink">
                  {formatBudgetLabel(budgetMin, budgetMax)}
                </span>
                <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-4.5 w-4.5 shrink-0 text-ink-45" />
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border-line bg-surface p-4 u-lift">
                <div className="grid grid-cols-2 gap-3">
                  <BudgetOptionList
                    idPrefix="hero-budget-min"
                    label="Prix min"
                    options={BUDGET_MIN_OPTIONS}
                    value={budgetMin}
                    onChange={setBudgetMin}
                  />
                  <BudgetOptionList
                    idPrefix="hero-budget-max"
                    label="Prix max"
                    options={BUDGET_MAX_OPTIONS}
                    value={budgetMax}
                    onChange={setBudgetMax}
                  />
                </div>
              </PopoverContent>
            </Popover>
          </Field>

          <button
            type="button"
            onClick={() => locationRef.current?.submit()}
            className="u-press u-btn-primary inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue px-6 text-[1rem] font-semibold text-white"
          >
            <Search strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            Rechercher
          </button>
        </div>
    </div>
  );
}
