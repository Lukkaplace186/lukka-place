'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const MAX_ROWS = 8;

/**
 * The payment plan as rows of label + percentage, with the running total in
 * view ("Total : 90 % — il manque 10 %") and presets for the plans Kinshasa
 * developers actually use. Posts `plan_label` / `plan_percent` pairs; the
 * server refuses a plan that does not reach exactly 100 % (an incomplete plan
 * is never shown publicly — it would promise a total that is not the price).
 */
export default function PaymentPlanEditor({ initial = [], presets = [], labels }) {
  const [rows, setRows] = useState(() => (initial.length ? initial.map((r) => ({ label: r.label, percent: String(r.percent) })) : [{ label: '', percent: '' }]));
  const total = rows.reduce((sum, r) => sum + (Number(String(r.percent).replace(',', '.')) || 0), 0);
  const rounded = Math.round(total * 100) / 100;
  const complete = Math.abs(rounded - 100) < 0.01;
  const empty = rows.every((r) => !r.label && !r.percent);

  function update(index, patch) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-3">
      {presets.length ? (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => setRows(preset.rows.map((r) => ({ label: r.label, percent: String(r.percent) })))}
              className="min-h-10 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink"
            >
              {preset.name}
            </button>
          ))}
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] gap-2">
          <input
            name="plan_label"
            value={row.label}
            onChange={(e) => update(index, { label: e.target.value })}
            placeholder={index === 0 ? labels.labelExample : ''}
            aria-label={labels.label}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm"
          />
          <input
            name="plan_percent"
            inputMode="decimal"
            value={row.percent}
            onChange={(e) => update(index, { percent: e.target.value })}
            placeholder="%"
            aria-label={labels.percent}
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm"
          />
          <button
            type="button"
            onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [{ label: '', percent: '' }]))}
            aria-label={labels.remove}
            className="inline-flex items-center justify-center rounded-lg text-ink-45 hover:text-danger"
          >
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {rows.length < MAX_ROWS ? (
          <button type="button" onClick={() => setRows((prev) => [...prev, { label: '', percent: '' }])} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-blue-deep">
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {labels.addRow}
          </button>
        ) : <span />}
        {!empty ? (
          <p className={`text-sm font-semibold ${complete ? 'text-success' : 'text-warning'}`} role="status">
            {complete ? labels.totalOk : labels.totalMissing.replace('{total}', String(rounded)).replace('{missing}', String(Math.round((100 - rounded) * 100) / 100))}
          </p>
        ) : null}
      </div>
    </div>
  );
}
