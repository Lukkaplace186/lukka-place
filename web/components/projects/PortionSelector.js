'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LOT_STATUS_LABEL_KEYS, TITLE_STATUS_LABEL_KEYS } from '@/lib/developmentRules';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

function usd(amount) {
  return amount === null || amount === undefined ? null : `${Math.round(Number(amount)).toLocaleString('fr-FR')} $`;
}

/**
 * One plot, sold in portions ("30 % pour X, 50 % pour Y, 100 % pour Z").
 * The bar fills to the chosen share; beside it, the portion's area, price and
 * price per m², and — when a bigger portion is cheaper per m² — the saving
 * against the smallest one, computed from the seller's own prices
 * (developmentRules.portionRows). Nothing is estimated: a portion with no
 * price shows no price.
 *
 * @param {{rows: ReturnType<typeof import('@/lib/developmentRules').portionRows>}} props
 */
export default function PortionSelector({ rows }) {
  const t = useT();
  const [activeId, setActiveId] = useState(rows.find((row) => row.status === 'available')?.id ?? rows[0]?.id);
  const active = rows.find((row) => row.id === activeId) || rows[0];
  if (!active) return null;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <div role="radiogroup" aria-label={t('projects.portions.choose')} className="flex flex-wrap gap-2">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            role="radio"
            aria-checked={row.id === active.id}
            onClick={() => setActiveId(row.id)}
            className={cn(
              'u-press inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors',
              row.id === active.id ? 'bg-ink text-white' : 'bg-canvas-alt text-ink hover:bg-canvas-deep',
              row.status === 'sold' && 'line-through opacity-60',
            )}
          >
            {row.share}%
          </button>
        ))}
      </div>

      {/* The plot, filled to the chosen share. */}
      <div className="relative h-20 overflow-hidden rounded-lg border-2 border-dashed border-ink-25 bg-[repeating-linear-gradient(45deg,var(--color-canvas-alt),var(--color-canvas-alt)_8px,var(--color-surface)_8px,var(--color-surface)_16px)]">
        <div
          className="absolute inset-y-0 left-0 flex items-center justify-end bg-green/80 pr-3 text-sm font-bold text-white transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${Math.min(100, active.share)}%` }}
        >
          {active.share}%
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div className="flex flex-col"><dt className="text-ink-45">{t('projects.lots.area')}</dt><dd className="u-tabular font-semibold text-ink">{active.area !== null ? `${active.area.toLocaleString('fr-FR')} m²` : '—'}</dd></div>
        <div className="flex flex-col"><dt className="text-ink-45">{t('projects.lots.price')}</dt><dd className="u-tabular font-semibold text-ink">{usd(active.price) ?? t('projects.card.priceOnRequest')}</dd></div>
        <div className="flex flex-col"><dt className="text-ink-45">{t('projects.lots.perM2')}</dt><dd className="u-tabular font-semibold text-ink">{active.perM2 !== null ? `${usd(active.perM2)}/m²` : '—'}</dd></div>
        <div className="flex flex-col"><dt className="text-ink-45">{t('projects.lots.status')}</dt><dd className="font-semibold text-ink">{t(LOT_STATUS_LABEL_KEYS[active.status])}</dd></div>
      </dl>

      {active.savingPerM2 ? (
        <p className="rounded-lg bg-success-tint px-3 py-2 text-sm font-semibold text-success">
          {t('projects.portions.saving', { amount: usd(active.savingPerM2) })}
        </p>
      ) : null}
      {active.titleStatus ? (
        <p className="text-sm text-ink-70">{t('projects.portions.titleLine', { status: t(TITLE_STATUS_LABEL_KEYS[active.titleStatus]) })}</p>
      ) : null}

      {active.status !== 'sold' ? (
        <Link href={`?interest=lot:${active.id}#contact`} className="u-btn-primary inline-flex min-h-11 items-center justify-center rounded-full bg-blue px-4 text-sm font-semibold text-white sm:self-start">
          {t('projects.portions.interested', { share: active.share })}
        </Link>
      ) : null}
    </div>
  );
}
