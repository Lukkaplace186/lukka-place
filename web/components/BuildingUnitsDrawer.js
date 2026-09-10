'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { buildingBedroomsLabel, orderedUnits } from '@/lib/buildingGroups';
import { compactPrice } from '@/lib/mapIcons';

/**
 * The unit list behind a multi-unit building pin.
 *
 * A building pin stands for several real listings, so clicking it cannot open
 * an InfoWindow preview of "the" listing — there isn't one. This slide-out
 * panel lists every available layout with its own price and its own link,
 * which is what turns four markers stacked invisibly on one coordinate into
 * four things a visitor can actually reach.
 *
 * Rendered only when a building is selected; `group` null means closed.
 */
export default function BuildingUnitsDrawer({ group, onClose }) {
  // Escape closes it. Bound only while open, so the handler is not left
  // attached for every visitor who never opens a building.
  useEffect(() => {
    if (!group) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [group, onClose]);

  if (!group) return null;

  const units = orderedUnits(group);
  const bedrooms = buildingBedroomsLabel(group);
  const heading = group.buildingName || group.representative?.address || 'Immeuble';

  return (
    <div className="absolute inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label={heading}>
      {/* Click-away. A plain div rather than a button: it must not be a tab
          stop competing with the real controls inside the panel. */}
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden="true" />

      <aside className="relative flex h-full w-full max-w-sm flex-col overflow-hidden bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{heading}</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {group.unitCount} unités disponibles
              {bedrooms ? ` · ${bedrooms}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            {/* Inline, not an icon font: this panel renders over a map that
                may still be loading, and a missing glyph would leave no
                visible way out. */}
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {units.map((unit) => (
            <li key={unit.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {/* compactPrice returns '' with no usable price; "N.C."
                      (non communiqué) says the true thing rather than
                      rendering a blank where a price belongs. */}
                  {compactPrice(unit.price, unit.purpose) || 'N.C.'}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  {[
                    unit.beds != null ? `${unit.beds} ch.` : null,
                    unit.bath != null ? `${unit.bath} sdb` : null,
                    unit.floor || null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || unit.title}
                </p>
              </div>
              <Link
                href={`/listings/${unit.slug || unit.id}`}
                className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50"
              >
                Voir détails
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
