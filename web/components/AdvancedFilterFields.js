'use client';

import { PillOption } from './FilterPill';
import { PARCELLE_SUBTYPES, AMENITY_GROUPS, DEPOSIT_MAX_OPTIONS } from '@/lib/constants';

const selectClass =
  'u-focus-ring w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-sm text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

function Field({ label, hint, children }) {
  return (
    <div>
      <span className="u-eyebrow mb-2 block">{label}</span>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-ink-45">{hint}</p> : null}
    </div>
  );
}

/**
 * The filter fields that don't earn their own top-level section in either
 * FiltersDrawer.js (desktop's "Plus de filtres" sheet) or FilterModal.js
 * (mobile's single consolidated "Filtres" sheet) — extracted here once both
 * needed the exact same real fields (Quartier, Sous-type de parcelle,
 * amenity groups, Conditions de location) rather than copy-pasting them.
 * Quartier depends on a commune being chosen first; Sous-type only exists
 * once Type de bien is Parcelle.
 *
 * `includeBedsBaths` is `false` only from FilterModal: that sheet already
 * has its own top-level Chambres/Salles de bain sections (the mobile
 * filter-modal spec asks for them explicitly), so rendering this pair again
 * on the same screen would just show the same two fields twice.
 * FiltersDrawer keeps the default `true` — it's a genuinely useful second
 * entry point there, since FiltersDrawer is a *separate* sheet from the
 * top-bar pills that already own Chambres/Salles de bain on desktop, not
 * the same screen the way FilterModal's own sections are.
 *
 * Values and setters come from FilterBar, which owns all filter state —
 * this component holds no state of its own, only controls that write back
 * into whatever the caller passed down.
 */
export default function AdvancedFilterFields({
  quartiers,
  commune,
  propertyType,
  values = {},
  setters = {},
  includeBedsBaths = true,
}) {
  const { quartier = '', parcelleSubtype = '', bedsMin = '', bathMin = '', depositMax = '', amenities = [] } = values;
  const { setQuartier, setParcelleSubtype, setBedsMin, setBathMin, setDepositMax, setAmenities } = setters;

  function toggleAmenity(key) {
    setAmenities?.(amenities.includes(key) ? amenities.filter((k) => k !== key) : [...amenities, key]);
  }

  return (
    <>
      <Field
        label="Quartier"
        hint={commune ? undefined : 'Choisissez d’abord une commune dans la barre de recherche.'}
      >
        <select
          key={commune}
          value={quartier}
          onChange={(e) => setQuartier?.(e.target.value)}
          disabled={!commune}
          className={selectClass}
        >
          <option value="">Tous les quartiers</option>
          {quartiers.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </Field>

      {propertyType === 'parcelle' ? (
        <Field label="Sous-type de parcelle">
          <select value={parcelleSubtype} onChange={(e) => setParcelleSubtype?.(e.target.value)} className={selectClass}>
            <option value="">Tous les sous-types</option>
            {PARCELLE_SUBTYPES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {includeBedsBaths ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Salles de bain">
            <select value={bathMin} onChange={(e) => setBathMin?.(e.target.value)} className={selectClass}>
              <option value="">Toutes</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </Field>

          {/* Same bedsMin state as FilterBar.js's top-bar "Chambres" pill
              (1-5, same options) — a second entry point, not a second
              field. */}
          <Field label="Chambres">
            <select value={bedsMin} onChange={(e) => setBedsMin?.(e.target.value)} className={selectClass}>
              <option value="">Toutes</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}

      {/* Énergie & Eau / Accessibilité & Sécurité — no structured column
          backs any of these (see lib/constants.js's AMENITY_GROUPS doc
          comment); each chip ANDs in a real word-boundary text match
          against the listing's own title/description in lib/listings.js.
          Real, working filters — just not database-verified ones, hence
          the caption below rather than silently implying otherwise. */}
      {AMENITY_GROUPS.slice(0, 2).map((group) => (
        <Field key={group.title} label={group.title}>
          <div className="flex flex-wrap gap-2">
            {group.options.map(({ key, label }) => (
              <PillOption key={key} selected={amenities.includes(key)} onClick={() => toggleAmenity(key)}>
                {label}
              </PillOption>
            ))}
          </div>
        </Field>
      ))}

      <Field label="Conditions de location">
        <div className="flex flex-col gap-3">
          <div>
            <span className="mb-2 block text-xs font-medium text-ink-70">Garantie / avance maximum</span>
            <select value={depositMax} onChange={(e) => setDepositMax?.(e.target.value)} className={selectClass}>
              {DEPOSIT_MAX_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            {AMENITY_GROUPS[2].options.map(({ key, label }) => (
              <PillOption key={key} selected={amenities.includes(key)} onClick={() => toggleAmenity(key)}>
                {label}
              </PillOption>
            ))}
          </div>
        </div>
      </Field>

      <p className="text-xs text-ink-45">
        Ces critères recherchent une mention réelle dans le titre ou la description de l&rsquo;annonce — un bien peut
        avoir cet équipement sans l&rsquo;avoir précisé.
      </p>
    </>
  );
}
