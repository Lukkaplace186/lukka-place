'use client';

import Link from '@/components/LocaleLink';
import { ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';

import { buildingBedroomsLabel, orderedUnits } from '@/lib/buildingGroups';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { compactPrice } from '@/lib/mapIcons';

/**
 * The unit list behind a multi-unit building pin.
 *
 * A building pin stands for several real listings, so clicking it cannot open
 * a preview of "the" listing — there isn't one. This panel lists every
 * available layout with its own price and its own link.
 *
 * Phone (2026-11-27, owner screenshot): a sheet rising from the bottom of the
 * map, at most 62% of its height. It used to be a full-height side panel, and
 * on a phone its title and close button sat under the floating search panel
 * (z-30, later in the DOM): a white wall with no visible way out and the map
 * gone. The sheet leaves the search and the top of the map in view, and the
 * dimmed map above it closes it. Desktop keeps the side panel.
 *
 * Rendered only when a building is selected; `group` null means closed.
 */
export default function BuildingUnitsDrawer({ group, onClose }) {
  const t = useT();

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
  const heading = group.buildingName || group.representative?.address || t('listings.map.building.fallbackName');
  // A developer's building (lib/projectUnits.js) links back to its project page.
  const project = group.listings.find((l) => l.project)?.project || null;

  return (
    <div
      data-building-sheet
      className="absolute inset-0 z-40 flex items-end lg:items-stretch lg:justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      {/* Click-away. A plain div rather than a button: it must not be a tab
          stop competing with the real controls inside the panel. */}
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} aria-hidden="true" />

      <aside className="u-rise relative flex max-h-[62%] w-full flex-col overflow-hidden rounded-t-3xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl lg:h-full lg:max-h-none lg:max-w-sm lg:rounded-none lg:pb-0">
        <div className="flex justify-center pt-2 lg:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-2 lg:p-4">
          <div className="min-w-0">
            <h2 className="u-title-card truncate text-ink">{heading}</h2>
            <p className="u-micro mt-0.5 text-ink-70">
              {t('listings.map.building.unitsAvailable', { count: group.unitCount })}
              {bedrooms ? ` · ${bedrooms}` : ''}
            </p>
            {project ? (
              <Link href={`/projets/${project.slug}`} className="u-micro-strong mt-1 inline-block text-blue-deep hover:underline">
                {t('listings.map.building.project')}
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('listings.map.building.close')}
            className="u-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-canvas-alt text-ink"
          >
            <X strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
          {units.map((unit) => (
            <li key={unit.id}>
              {/* The whole row is the link: a thumb aims at a row, not at a
                  small button at its end. */}
              <Link
                href={`/listings/${unit.id}`}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 active:bg-canvas-alt lg:hover:bg-canvas-alt"
              >
                <div className="min-w-0">
                  <p className="u-tabular text-[15px] font-bold text-ink">
                    {/* compactPrice returns '' with no usable price; "N.C."
                        (non communiqué) says the true thing rather than
                        rendering a blank where a price belongs. */}
                    {compactPrice(unit.price, unit.purpose) || 'N.C.'}
                  </p>
                  <p className="u-micro mt-0.5 truncate text-ink-70">
                    {[
                      unit.unit_label || null,
                      unit.unit_floor != null ? (Number(unit.unit_floor) === 0 ? 'RDC' : Number(unit.unit_floor) === 1 ? '1er ét.' : `${unit.unit_floor}e ét.`) : null,
                      Number(unit.beds) > 0 ? `${unit.beds} ch.` : null,
                      unit.bath != null ? `${unit.bath} sdb` : null,
                      unit.floor || null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || unit.title}
                  </p>
                </div>
                <span className="u-micro-strong flex shrink-0 items-center gap-0.5 text-blue-deep">
                  {t('listings.map.building.view')}
                  <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
