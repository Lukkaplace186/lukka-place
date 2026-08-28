'use client';

import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { PillOption } from './FilterPill';
import { PARCELLE_SUBTYPES, AMENITY_GROUPS, DEPOSIT_MAX_OPTIONS } from '@/lib/constants';

const selectClass =
  'u-focus-ring w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-sm text-ink ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * "Plus de filtres" — the fields that do not earn their own top-bar pill.
 *
 * Quartier depends on a commune being chosen first; Sous-type only exists
 * once Type de bien is Parcelle; Salles de bain is a secondary refinement
 * (`bath` is a real column FilterBar.js's top bar has no pill for). Chambres
 * here is a second, redundant entry point to the exact same `bedsMin` state
 * FilterBar.js's own top-bar "Chambres" pill already owns — not a separate
 * field — for a visitor who opens "Plus de filtres" without noticing the
 * pill; changing either one updates both instantly since they share state.
 *
 * Values and setters come from FilterBar, which owns all filter state. This
 * sheet renders through a Radix portal to document.body, so it is outside
 * the form element — it holds no form fields of its own, only controls that
 * write back into that state.
 */
function Field({ label, hint, children }) {
  return (
    <div>
      <span className="u-eyebrow mb-2 block">{label}</span>
      {children}
      {hint ? <p className="mt-1.5 text-xs text-ink-45">{hint}</p> : null}
    </div>
  );
}

export default function FiltersDrawer({
  open,
  onClose,
  onApply,
  quartiers,
  commune,
  propertyType,
  values = {},
  setters = {},
  resultCountLabel,
  resultPending,
}) {
  const { quartier = '', parcelleSubtype = '', bedsMin = '', bathMin = '', depositMax = '', amenities = [] } = values;
  const { setQuartier, setParcelleSubtype, setBedsMin, setBathMin, setDepositMax, setAmenities } = setters;

  function reset() {
    setQuartier?.('');
    setParcelleSubtype?.('');
    setBedsMin?.('');
    setBathMin?.('');
    setDepositMax?.('');
    setAmenities?.([]);
  }

  function toggleAmenity(key) {
    setAmenities?.(amenities.includes(key) ? amenities.filter((k) => k !== key) : [...amenities, key]);
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl border-line bg-surface">
        <SheetHeader className="border-b border-line">
          <SheetTitle className="font-display text-xl font-normal tracking-[-0.01em]">Plus de filtres</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 py-5">
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
              <select
                value={parcelleSubtype}
                onChange={(e) => setParcelleSubtype?.(e.target.value)}
                className={selectClass}
              >
                <option value="">Tous les sous-types</option>
                {PARCELLE_SUBTYPES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

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
                field. See the doc comment at the top of this file. */}
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

          {/* Énergie & Eau / Accessibilité & Sécurité — no structured column
              backs any of these (see lib/constants.js's AMENITY_GROUPS doc
              comment); each chip ANDs in a real word-boundary text match
              against the listing's own title/description in
              lib/listings.js. Real, working filters — just not
              database-verified ones, hence the caption below rather than
              silently implying otherwise. */}
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
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
          <Link
            href="/listings"
            onClick={reset}
            className="u-press u-btn-secondary flex-1 rounded-full py-2.5 text-center text-sm font-semibold text-ink"
          >
            Réinitialiser
          </Link>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApply?.();
            }}
            className={`u-press flex-1 rounded-full bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary ${resultPending ? 'opacity-70' : ''}`}
          >
            {resultCountLabel || 'Voir les résultats'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
