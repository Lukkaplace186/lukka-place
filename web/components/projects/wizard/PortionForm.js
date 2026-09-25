'use client';

import { useState } from 'react';
import { PORTION_PRESETS, pricePerM2 } from '@/lib/developmentRules';

function num(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * One portion of a parcel (30 % / 50 % / 100 %): share and price, with the
 * area and the price per m² worked out live from the parcel's own area as the
 * developer types — arithmetic on their numbers, nothing estimated. A
 * `warning` (bigger share dearer per m² than a smaller one) is shown, never
 * enforced.
 */
export default function PortionForm({ action, landArea, portion = null, labels, statuses = null, warning = null }) {
  const [share, setShare] = useState(portion?.share ?? '');
  const [price, setPrice] = useState(portion?.price ?? '');
  const shareNum = num(share);
  const area = landArea !== null && shareNum !== null ? Math.round((landArea * shareNum) / 100) : null;
  const perM2 = pricePerM2(num(price), area);
  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);

  return (
    <form action={action} className="flex flex-col gap-3">
      {!portion ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={labels.presets}>
          {PORTION_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setShare(preset)}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${Number(share) === preset ? 'border-blue bg-blue text-white' : 'border-line bg-surface text-ink'}`}
            >
              {preset} %
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="u-micro-strong text-ink-70">{labels.share}</span>
          <input name="share_percent" inputMode="decimal" required value={share} onChange={(e) => setShare(e.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="u-micro-strong text-ink-70">{labels.price}</span>
          <input name="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" />
        </label>
        {statuses ? (
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink-70">{labels.status}</span>
            <select name="status" defaultValue={portion?.status || 'available'} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm">
              {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        ) : <input type="hidden" name="status" value="available" />}
        <div className="flex flex-col justify-end gap-0.5 text-[0.8125rem] text-ink-70">
          <span>{area !== null ? `${fmt(area)} m²` : labels.noArea}</span>
          <span className="font-semibold text-ink">{perM2 !== null ? `${fmt(perM2)} $ / m²` : '—'}</span>
        </div>
      </div>
      <input type="hidden" name="label" value={shareNum !== null ? `${shareNum} %` : ''} />
      {warning ? <p className="text-[0.8125rem] font-semibold text-warning">{warning}</p> : null}
      <button type="submit" className="u-btn-primary inline-flex min-h-11 items-center self-start rounded-full bg-blue px-5 text-sm font-semibold text-white">
        {portion ? labels.save : labels.add}
      </button>
    </form>
  );
}
