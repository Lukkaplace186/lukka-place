'use client';

import { useRef, useState } from 'react';
import { PLAN_BOX, parsePolygon, polygonToText } from '@/lib/developmentRules';
import { useT } from '@/lib/i18n/client';

/**
 * Trace one lot on the site plan: click the plan to drop the lot's corners in
 * order, "Annuler le dernier point" to step back, "Effacer" to start over.
 * The polygon is written into a hidden `polygon` field in PLAN_BOX
 * coordinates relative to the image — the same box the public LotPlan draws
 * in, so what is traced here is exactly what a visitor taps. The raw text
 * stays editable for fine corrections.
 *
 * `others` are the project's other traced lots, drawn faintly so a new lot is
 * placed beside them rather than over them.
 */
export default function LotPlanEditor({ planImage, initial = null, others = [] }) {
  const t = useT();
  const [points, setPoints] = useState(() => (Array.isArray(initial) ? initial : []));
  const [text, setText] = useState(() => polygonToText(initial));
  const frameRef = useRef(null);

  function commit(next) {
    setPoints(next);
    setText(polygonToText(next));
  }

  function onClick(event) {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = Math.round(((event.clientX - rect.left) / rect.width) * PLAN_BOX);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * PLAN_BOX);
    commit([...points, [Math.min(PLAN_BOX, Math.max(0, x)), Math.min(PLAN_BOX, Math.max(0, y))]]);
  }

  function onText(value) {
    setText(value);
    const parsed = parsePolygon(value);
    setPoints(parsed || []);
  }

  if (!planImage) {
    return (
      <label className="flex flex-col gap-1">
        <span className="u-micro-strong text-ink-70">{t('admin.projects.lots.polygon')}</span>
        <input name="polygon" defaultValue={polygonToText(initial)} className="min-h-10 rounded-lg border border-line px-3 font-mono text-xs" />
        <span className="text-[0.75rem] text-ink-45">{t('admin.projects.lots.noPlan')}</span>
      </label>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="u-micro-strong text-ink-70">{t('admin.projects.lots.trace')}</span>
      <div ref={frameRef} className="relative cursor-crosshair overflow-hidden rounded-lg border border-line" onClick={onClick} role="presentation">
        {/* eslint-disable-next-line @next/next/no-img-element -- natural aspect ratio is the geometry */}
        <img src={planImage} alt="" className="block h-auto w-full select-none" draggable={false} />
        <svg viewBox={`0 0 ${PLAN_BOX} ${PLAN_BOX}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
          {others.map((polygon, i) => (
            <polygon key={i} points={polygonToText(polygon)} fill="#64748b" fillOpacity="0.25" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          ))}
          {points.length >= 2 ? (
            <polygon points={polygonToText(points)} fill="#1e3aa8" fillOpacity="0.35" stroke="#1e3aa8" strokeWidth="3" vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>
        {points.map(([x, y], i) => (
          <span
            key={`${x}-${y}-${i}`}
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue"
            style={{ left: `${(x / PLAN_BOX) * 100}%`, top: `${(y / PLAN_BOX) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => commit(points.slice(0, -1))} disabled={!points.length} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40">
          {t('admin.projects.lots.undo')}
        </button>
        <button type="button" onClick={() => commit([])} disabled={!points.length} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40">
          {t('admin.projects.lots.clear')}
        </button>
        <span className="text-[0.75rem] text-ink-45">{t('admin.projects.lots.points', { count: points.length })}</span>
      </div>
      <input
        name="polygon"
        value={text}
        onChange={(event) => onText(event.target.value)}
        aria-label={t('admin.projects.lots.polygon')}
        className="min-h-9 rounded-lg border border-line px-3 font-mono text-xs text-ink-70"
      />
    </div>
  );
}
