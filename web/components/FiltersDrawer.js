'use client';

import Link from 'next/link';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { PARCELLE_SUBTYPES } from '@/lib/constants';

const selectClass =
  'w-full rounded-md border border-line bg-canvas px-3 py-2.5 text-sm text-ink ' +
  'focus:border-blue focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/**
 * "Plus de filtres" — the fields that do not earn their own top-bar pill.
 *
 * Quartier depends on a commune being chosen first; Sous-type only exists
 * once Type de bien is Parcelle; Salles de bain and Surface are secondary
 * refinements. The last two are newly filterable: `bath` and `area` are real
 * columns that no part of the UI could previously search on.
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
  const { quartier = '', parcelleSubtype = '', bathMin = '', areaMin = '' } = values;
  const { setQuartier, setParcelleSubtype, setBathMin, setAreaMin } = setters;

  function reset() {
    setQuartier?.('');
    setParcelleSubtype?.('');
    setBathMin?.('');
    setAreaMin?.('');
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

            <Field label="Surface min." hint="En mètres carrés.">
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={areaMin}
                onChange={(e) => setAreaMin?.(e.target.value)}
                placeholder="ex. 120"
                className={selectClass}
              />
            </Field>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
          <Link
            href="/listings"
            onClick={reset}
            className="u-press flex-1 rounded-full border border-line py-2.5 text-center text-sm font-semibold text-ink transition-colors hover:bg-canvas-alt"
          >
            Réinitialiser
          </Link>
          <button
            type="button"
            onClick={() => {
              onClose();
              onApply?.();
            }}
            className={`u-press flex-1 rounded-full bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep ${resultPending ? 'opacity-70' : ''}`}
          >
            {resultCountLabel || 'Voir les résultats'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
