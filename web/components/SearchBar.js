'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowRight, Search, MapPin, ChevronDown } from 'lucide-react';
import LocationAutocomplete from './LocationAutocomplete';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The hero search panel — web/Design's SearchPanel
 * (components/property/SearchPanel.jsx), rendered at full container width.
 *
 * Three parts, in the design's order:
 *   1. an underline Tabs row (Louer / Acheter / Parcelles / Agents) — the
 *      design's own `homeTabs`, with a 3px royal-600 underline on the active
 *      tab over a 1px hairline, not the rounded pill group this used before
 *   2. a labelled field row: location (flex 2), Type de bien (flex 1),
 *      Budget max (flex 1), and a 56px primary Rechercher button
 *   3. a royal-700 strip carrying the "list your property" cross-sell
 *
 * Fields carry visible labels above them ("Commune, quartier ou référence",
 * "Type de bien", "Budget max") because the design's Input/Select do; the
 * previous version was placeholder-only.
 *
 * Tab behaviour: Louer/Acheter set transaction_type, Parcelles forces
 * property_type=parcelle and drops the now-redundant type select, and
 * Agents isn't a property search at all — there is no per-agent search
 * backend, so that tab swaps the field row for a single honest link to
 * /agents (the real directory) rather than a search box that does nothing.
 *
 * `propertyTypes` is real and DB-derived (getPropertyTypeFacets(), the same
 * source FilterBar's own pill uses), so a type with zero results is never
 * offered. `BUDGET_OPTIONS` is a small fixed set of round ceilings — a
 * filter-UI convenience, not a claim about the data.
 *
 * Placeholder copy stays "Gombe, Ma Campagne" per the design, and the label
 * says "référence" (never "repère") per the root CLAUDE.md.
 */
const HOME_TABS = [
  { value: 'louer', label: 'Louer' },
  { value: 'acheter', label: 'Acheter' },
  { value: 'parcelles', label: 'Parcelles' },
  { value: 'agents', label: 'Agents' },
];

const TRANSACTION_BY_TAB = { louer: 'location', acheter: 'vente' };

const BUDGET_OPTIONS = [
  { value: '', label: 'Tous les budgets' },
  { value: '500', label: 'Jusqu’à 500 $' },
  { value: '1000', label: 'Jusqu’à 1 000 $' },
  { value: '2000', label: 'Jusqu’à 2 000 $' },
  { value: '5000', label: 'Jusqu’à 5 000 $' },
];

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
  const [budgetMax, setBudgetMax] = useState('');
  const isAgentsTab = homeTab === 'agents';
  const isParcellesTab = homeTab === 'parcelles';
  const sellHref = getCentralWhatsAppHref('Bonjour, je souhaite lister mon bien sur Lukka Place.');
  const locationRef = useRef(null);

  const extraParams = {
    transaction_type: TRANSACTION_BY_TAB[homeTab] || '',
    property_type: isParcellesTab ? 'parcelle' : propertyType,
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
    <div className="overflow-hidden rounded-2xl border border-line bg-surface u-shadow-panel">
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

      {isAgentsTab ? (
        <div className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.9375rem] text-ink-70">Parcourez tous les agents actifs sur Lukka Place.</p>
          <Link
            href="/agents"
            className="u-press u-btn-primary inline-flex h-14 shrink-0 items-center gap-2 rounded-lg bg-blue px-6 text-[1rem] font-semibold text-white"
          >
            Voir les agents
            <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </Link>
        </div>
      ) : (
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

          {/* Hidden on Parcelles: the tab itself already declares the type,
              so a second control saying the same thing is redundant. */}
          {!isParcellesTab ? (
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
          ) : null}

          <Field label="Budget max" htmlFor="hero-budget" className="sm:flex-[1_1_10.625rem]">
            <div className={`${FIELD_SHELL} relative`}>
              <select
                id="hero-budget"
                value={budgetMax}
                onChange={(e) => setBudgetMax(e.target.value)}
                className="min-w-0 flex-1 appearance-none bg-transparent text-[1rem] font-medium text-ink focus:outline-none"
              >
                {BUDGET_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="pointer-events-none h-4.5 w-4.5 shrink-0 text-ink-45" />
            </div>
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
      )}

      {/* Royal cross-sell strip. Real central number, honest disabled state
          when NEXT_PUBLIC_WHATSAPP_NUMBER is unset (see lib/whatsapp.js). */}
      <div className="flex flex-col items-start gap-3 bg-blue-deep px-6 py-5 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-[0.875rem] font-bold text-white">Vous avez un bien à louer ou à vendre ?</span>
          <span className="text-[0.8125rem] text-white/72">
            Envoyez photos et détails sur WhatsApp. Nous vérifions, puis nous publions.
          </span>
        </div>
        {sellHref ? (
          <a
            href={sellHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2.5 text-[0.875rem] font-semibold text-white ring-[1.5px] ring-inset ring-white/72 transition-colors hover:bg-white hover:text-blue-deep sm:ml-auto"
          >
            Publier par WhatsApp
            <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </a>
        ) : (
          <span className="shrink-0 text-[0.8125rem] text-white/50 sm:ml-auto">Publication indisponible</span>
        )}
      </div>
    </div>
  );
}
