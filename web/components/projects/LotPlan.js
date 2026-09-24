'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LOT_STATUS_LABEL_KEYS, PLAN_BOX, TITLE_STATUS_LABEL_KEYS, polygonCentre, pricePerM2 } from '@/lib/developmentRules';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

function usd(amount) {
  return amount === null || amount === undefined ? null : `${Math.round(Number(amount)).toLocaleString('fr-FR')} $`;
}

/**
 * The site plan with every traced lot drawn over it, coloured by status —
 * disponible / réservé / vendu, from the lot rows the developer keeps
 * current. Tap a lot to see its size, price, price per m² and title status.
 *
 * Geometry: the plan is a plain <img> at its natural aspect; the SVG over it
 * uses a 0..PLAN_BOX box stretched to the image (preserveAspectRatio none),
 * which is exactly the box the admin traced in (app/admin/projets/[id]/
 * LotPlanEditor.js). Labels are HTML, positioned in percent, so the stretch
 * never distorts text.
 */
export default function LotPlan({ planImage, lots, projectName }) {
  const t = useT();
  const traced = lots.filter((lot) => Array.isArray(lot.polygon) && lot.polygon.length >= 3);
  const [activeId, setActiveId] = useState(traced.find((lot) => lot.status === 'available')?.id ?? traced[0]?.id ?? null);
  const active = traced.find((lot) => lot.id === activeId) || null;

  if (!planImage || traced.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-card border border-line bg-canvas-alt">
        {/* eslint-disable-next-line @next/next/no-img-element -- natural aspect ratio is the geometry */}
        <img src={planImage} alt={t('projects.lots.planAlt', { name: projectName })} className="block h-auto w-full select-none" draggable={false} />
        <svg
          viewBox={`0 0 ${PLAN_BOX} ${PLAN_BOX}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label={t('projects.lots.planLabel')}
        >
          {traced.map((lot) => (
            <polygon
              key={lot.id}
              points={lot.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
              className="lkp-lot"
              vectorEffect="non-scaling-stroke"
              data-status={lot.status}
              data-active={String(lot.id === activeId)}
              tabIndex={0}
              role="button"
              aria-label={`${lot.label} — ${t(LOT_STATUS_LABEL_KEYS[lot.status])}`}
              onClick={() => setActiveId(lot.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActiveId(lot.id);
                }
              }}
            />
          ))}
        </svg>
        {traced.map((lot) => {
          const centre = polygonCentre(lot.polygon);
          if (!centre) return null;
          return (
            <span
              key={`label-${lot.id}`}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-white/90 px-1.5 py-0.5 text-[0.6875rem] font-bold text-ink shadow-sm"
              style={{ left: `${(centre[0] / PLAN_BOX) * 100}%`, top: `${(centre[1] / PLAN_BOX) * 100}%` }}
            >
              {lot.label}
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-[0.75rem] text-ink-70">
        {['available', 'reserved', 'sold'].map((status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 10 10" className="h-3 w-3" aria-hidden="true"><rect width="10" height="10" rx="2" className="lkp-lot" data-status={status} /></svg>
            {t(LOT_STATUS_LABEL_KEYS[status])}
          </span>
        ))}
      </div>

      {active ? (
        <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-ink">{active.label}</p>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[0.75rem] font-semibold',
                active.status === 'available' && 'bg-success-tint text-success',
                active.status === 'reserved' && 'bg-warning-tint text-warning',
                active.status === 'sold' && 'bg-danger-tint text-danger',
              )}
            >
              {t(LOT_STATUS_LABEL_KEYS[active.status])}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {active.area_m2 !== null ? (<><dt className="text-ink-45">{t('projects.lots.area')}</dt><dd className="u-tabular text-right text-ink">{Number(active.area_m2).toLocaleString('fr-FR')} m²</dd></>) : null}
            {active.price !== null ? (<><dt className="text-ink-45">{t('projects.lots.price')}</dt><dd className="u-tabular text-right font-semibold text-ink">{usd(active.price)}</dd></>) : null}
            {pricePerM2(active.price, active.area_m2) !== null ? (<><dt className="text-ink-45">{t('projects.lots.perM2')}</dt><dd className="u-tabular text-right text-ink">{usd(pricePerM2(active.price, active.area_m2))}/m²</dd></>) : null}
            {active.title_status ? (<><dt className="text-ink-45">{t('projects.lots.title')}</dt><dd className="text-right text-ink">{t(TITLE_STATUS_LABEL_KEYS[active.title_status])}</dd></>) : null}
          </dl>
          {active.status !== 'sold' ? (
            <Link href={`?interest=lot:${active.id}#contact`} className="u-btn-primary mt-1 inline-flex min-h-11 items-center justify-center rounded-full bg-blue px-4 text-sm font-semibold text-white">
              {t('projects.lots.interested')}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
