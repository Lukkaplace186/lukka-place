'use client';

import { PillOption } from './FilterPill';
import { useMemo } from 'react';
import { PARCELLE_SUBTYPES, AMENITY_GROUPS, DEPOSIT_RANGE_OPTIONS } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

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
 * needed the exact same real fields (Commune, Quartier, Sous-type de
 * parcelle, amenity groups, Conditions de paiement) rather than copy-pasting
 * them. Sous-type only exists once Type de bien is Parcelle.
 *
 * Commune and Quartier cascade both ways (2026-09-24). Quartier used to be
 * disabled until a commune had been typed into the search box, which read as
 * a broken control. Now: with a commune, Quartier lists that commune's
 * quartiers; without one it lists every Kinshasa quartier, alphabetically.
 * Picking a quartier that exists in exactly one commune fills that commune in
 * too; one that exists in several (Salongo) leaves the commune empty and
 * filters on the quartier alone. Both lists come from `locations`, the real
 * commune -> quartier hierarchy (kinshasa_locations.json via the engine) —
 * nothing here is typed by hand.
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
  locations = {},
  commune,
  propertyType,
  values = {},
  setters = {},
  includeBedsBaths = true,
}) {
  const { quartier = '', parcelleSubtype = '', bedsMin = '', bathMin = '', depositRange = '', amenities = [] } = values;
  const { setCommune, setQuartier, setParcelleSubtype, setBedsMin, setBathMin, setDepositRange, setAmenities } = setters;

  const t = useT();

  const { communes, allQuartiers, communesByQuartier } = useMemo(() => {
    const byQuartier = new Map();
    for (const [c, qs] of Object.entries(locations || {})) {
      for (const q of qs || []) {
        if (!byQuartier.has(q)) byQuartier.set(q, []);
        byQuartier.get(q).push(c);
      }
    }
    const collator = new Intl.Collator('fr', { sensitivity: 'base' });
    return {
      communes: Object.keys(locations || {}).sort(collator.compare),
      allQuartiers: [...byQuartier.keys()].sort(collator.compare),
      communesByQuartier: byQuartier,
    };
  }, [locations]);

  // A commune in the URL that the hierarchy doesn't know (engine down, or a
  // DB-only name) is still offered, so the select never silently shows
  // "Toutes les communes" for a search that is scoped to one.
  const communeOptions = commune && !communes.includes(commune) ? [commune, ...communes] : communes;
  const quartierOptions = commune ? locations?.[commune] || [] : allQuartiers;

  function chooseCommune(next) {
    setCommune?.(next);
    // A quartier that does not belong to the new commune would AND two
    // places together and return nothing.
    if (quartier && next && !(locations?.[next] || []).includes(quartier)) setQuartier?.('');
  }

  function chooseQuartier(next) {
    setQuartier?.(next);
    if (!next || commune) return;
    const owners = communesByQuartier.get(next) || [];
    if (owners.length === 1) setCommune?.(owners[0]);
  }

  function toggleAmenity(key) {
    setAmenities?.(amenities.includes(key) ? amenities.filter((k) => k !== key) : [...amenities, key]);
  }

  return (
    <>
      <Field label={t('listings.filters.commune')}>
        <select value={commune || ''} onChange={(e) => chooseCommune(e.target.value)} className={selectClass}>
          <option value="">{t('listings.filters.allCommunes')}</option>
          {communeOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t('listings.filters.quartier')}>
        <select value={quartier} onChange={(e) => chooseQuartier(e.target.value)} className={selectClass}>
          <option value="">{t('listings.filters.allQuartiers')}</option>
          {quartier && !quartierOptions.includes(quartier) ? <option value={quartier}>{quartier}</option> : null}
          {quartierOptions.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </Field>

      {propertyType === 'parcelle' ? (
        <Field label={t('listings.filters.parcelleSubtype')}>
          <select value={parcelleSubtype} onChange={(e) => setParcelleSubtype?.(e.target.value)} className={selectClass}>
            <option value="">{t('listings.filters.allSubtypes')}</option>
            {PARCELLE_SUBTYPES.map(({ value, labelKey }) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {includeBedsBaths ? (
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('listings.filters.bathrooms')}>
            <select value={bathMin} onChange={(e) => setBathMin?.(e.target.value)} className={selectClass}>
              <option value="">{t('listings.filters.any')}</option>
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
              <option value="">{t('listings.filters.any')}</option>
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
        <Field key={group.titleKey} label={t(group.titleKey)}>
          <div className="flex flex-wrap gap-2">
            {group.options.map(({ key, labelKey }) => (
              <PillOption key={key} selected={amenities.includes(key)} onClick={() => toggleAmenity(key)}>
                {t(labelKey)}
              </PillOption>
            ))}
          </div>
        </Field>
      ))}

      <Field label={t('listings.amenityGroups.paymentTerms')}>
        <div className="flex flex-col gap-3">
          <div>
            <span className="mb-2 block text-xs font-medium text-ink-70">{t('listings.filters.depositRangeLabel')}</span>
            <select value={depositRange} onChange={(e) => setDepositRange?.(e.target.value)} className={selectClass}>
              {DEPOSIT_RANGE_OPTIONS.map(({ value, labelKey }) => (
                <option key={value} value={value}>
                  {t(labelKey)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-45">{t('listings.filters.depositRangeHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AMENITY_GROUPS[2].options.map(({ key, labelKey }) => (
              <PillOption key={key} selected={amenities.includes(key)} onClick={() => toggleAmenity(key)}>
                {t(labelKey)}
              </PillOption>
            ))}
          </div>
        </div>
      </Field>

      <p className="text-xs text-ink-45">{t('listings.filters.textMatchNote')}</p>
    </>
  );
}
