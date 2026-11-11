'use client';

import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { DEPOSIT_PRESETS, MONTH_LIMITS, clampMonths, moveInCost } from '@/lib/depositCalc';
import { cn } from '@/lib/utils';

/**
 * `:::calculateur` — the reader types a monthly rent and the months asked
 * (garantie / avance / commission) and sees the move-in total, item by item,
 * next to the ceiling of Loi n° 15/025 (lib/depositCalc.js).
 *
 * Labels arrive from the server as `{placeholder}` templates (ArticleBody),
 * so this component needs no dictionary namespace of its own. FC amounts use
 * the site's reference rate with its real date, marked "≈" like every
 * converted price on the site — never presented as a dealing rate.
 *
 * Opens on a worked example (670 $, 3 + 1 + 1) so the first view already
 * shows what the tool does; the server render is that example, complete.
 */

const SEGMENTS = [
  { key: 'deposit', color: 'var(--blue)' },
  { key: 'firstMonth', color: 'var(--brass)' },
  { key: 'extraAdvance', color: 'var(--danger-500)' },
  { key: 'commission', color: '#7c3aad' },
];
const RENT_EXAMPLES = [150, 250, 670, 1450, 3000];
const START = { rent: 670, deposit: 3, advance: 1, commission: 1 };

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

function parseAmount(text) {
  const n = Number.parseFloat(String(text).replace(/[\s  ,]/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function Bar({ parts, max, label, total, over }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[0.8125rem] font-semibold text-ink">
        <span>{label}</span>
        <span className="u-tabular font-medium text-ink-70">{total}</span>
      </div>
      <div className="flex h-8 overflow-hidden rounded-lg bg-canvas-alt" aria-hidden="true">
        {SEGMENTS.map(({ key, color }) =>
          parts[key] > 0 ? (
            <span
              key={key}
              className="h-full border-l-2 border-surface transition-[width] duration-500 ease-out first:border-l-0 motion-reduce:transition-none"
              style={{
                width: `${(parts[key] / max) * 100}%`,
                background: color,
                backgroundImage: over?.[key]
                  ? 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,.4) 6px 9px)'
                  : undefined,
              }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

function Stepper({ id, label, color, value, kind, onChange, labels, display }) {
  const { step } = MONTH_LIMITS[kind];
  return (
    <div className="flex items-center justify-between gap-3 border-t border-dashed border-line py-2 first:border-t-0">
      <span id={`${id}-label`} className="flex items-center gap-2 text-[0.9375rem] leading-snug text-ink">
        <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px]" style={{ background: color }} />
        {label}
      </span>
      <span className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-line" role="group" aria-labelledby={`${id}-label`}>
        <button type="button" onClick={() => onChange(clampMonths(kind, value - step))} aria-label={labels.less} className="grid size-10 place-items-center bg-canvas-alt text-ink hover:bg-blue-tint">
          <Minus aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
        <output id={id} aria-live="polite" className="u-tabular min-w-12 text-center text-[0.9375rem] font-semibold text-ink">
          {display(value)}
        </output>
        <button type="button" onClick={() => onChange(clampMonths(kind, value + step))} aria-label={labels.more} className="grid size-10 place-items-center bg-canvas-alt text-ink hover:bg-blue-tint">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
      </span>
    </div>
  );
}

function Tag({ tone, children }) {
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide',
        tone === 'back' && 'bg-blue-tint text-blue-deep',
        tone === 'gone' && 'bg-canvas-alt text-ink-45',
        tone === 'over' && 'bg-danger-tint text-danger',
      )}
    >
      {children}
    </span>
  );
}

export default function DepositCalculator({ labels, locale = 'fr', rate }) {
  const [rent, setRent] = useState(START.rent);
  const [rentText, setRentText] = useState(null);
  const [currency, setCurrency] = useState('usd');
  const [months, setMonths] = useState({ deposit: START.deposit, advance: START.advance, commission: START.commission });

  const numberLocale = locale === 'en' ? 'en-US' : 'fr-FR';
  const fmtNum = (n, digits = 0) =>
    Number(n).toLocaleString(numberLocale, { maximumFractionDigits: digits }).replace(/ /g, ' ');
  const cdf = rate?.cdfPerUsd > 0 ? rate.cdfPerUsd : null;
  // FC amounts are approximate; the "≈" is shown where a figure stands alone,
  // not in every table cell (the rate line above already says so).
  const money = (usd, { approx = true } = {}) => {
    if (currency === 'cdf' && cdf) return `${approx ? '≈\u00a0' : ''}${fmtNum(Math.round((usd * cdf) / 100) * 100)}\u00a0FC`;
    const v = fmtNum(Math.round(usd));
    return locale === 'en' ? `$${v}` : `${v} $`;
  };
  const shownRent = (usd) => (currency === 'cdf' && cdf ? Math.round(usd * cdf) : Math.round(usd * 100) / 100);

  const result = useMemo(() => moveInCost({ rent, ...months }), [rent, months]);
  const setMonth = (kind) => (v) => setMonths((m) => ({ ...m, [kind]: v }));
  const presetKey = [months.deposit, months.advance, months.commission].join('+');

  const onRentInput = (event) => {
    setRentText(event.target.value);
    const n = parseAmount(event.target.value);
    setRent(currency === 'cdf' && cdf ? n / cdf : n);
  };
  const switchCurrency = (next) => {
    setCurrency(next);
    setRentText(null);
  };

  const max = result ? Math.max(result.askedTotal, result.legalTotal) : 0;
  const rows = result
    ? [
        { key: 'deposit', name: labels.rowDeposit, sub: fill(labels.rowDepositSub, { months: fmtNum(months.deposit) }), a: result.asked.deposit, l: result.legal.deposit, tag: result.over.deposit ? 'over' : 'back' },
        { key: 'firstMonth', name: labels.rowFirst, sub: labels.rowFirstSub, a: result.asked.firstMonth, l: result.legal.firstMonth, tag: 'gone' },
        { key: 'extraAdvance', name: labels.rowExtra, sub: fill(labels.rowExtraSub, { months: fmtNum(months.advance - 1) }), a: result.asked.extraAdvance, l: 0, tag: 'over' },
        { key: 'commission', name: labels.rowCommission, sub: fill(labels.rowCommissionSub, { months: fmtNum(months.commission, 1) }), a: result.asked.commission, l: result.legal.commission, tag: result.over.commission ? 'over' : 'gone' },
      ].filter((row) => row.a > 0)
    : [];
  const tagText = { back: labels.tagRefundable, gone: labels.tagNotRefundable, over: labels.tagOverLaw };

  const pill = (active) =>
    cn(
      'u-tabular min-h-9 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors',
      active ? 'border-blue bg-blue-tint text-ink' : 'border-line bg-canvas-alt text-ink-70 hover:border-ink-25',
    );

  return (
    <section aria-labelledby="deposit-calc-title" className="not-prose overflow-hidden rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]">
      <header className="flex flex-col gap-1 px-4 pt-4 sm:px-6 sm:pt-5">
        <h3 id="deposit-calc-title" className="u-title-card text-ink">{labels.title}</h3>
        <p className="u-micro text-ink-45">{labels.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5 border-b border-line px-4 py-4 sm:px-6 md:border-b-0 md:border-r">
          <div className="flex flex-col gap-2">
            <label htmlFor="deposit-calc-rent" className="u-eyebrow text-ink-45">{labels.rentLabel}</label>
            <div className="flex items-center rounded-xl border-2 border-line bg-canvas-alt px-3 focus-within:border-blue">
              <span aria-hidden="true" className="text-xl font-semibold text-ink-45">{currency === 'cdf' && cdf ? 'FC' : '$'}</span>
              <input
                id="deposit-calc-rent"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={rentText ?? (rent > 0 ? fmtNum(shownRent(rent), 2) : '')}
                onChange={onRentInput}
                onBlur={() => setRentText(null)}
                className="u-tabular w-full min-w-0 bg-transparent px-2 py-2.5 text-[1.75rem] font-bold text-ink outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={labels.examples}>
              {RENT_EXAMPLES.map((usd) => (
                <button key={usd} type="button" aria-pressed={Math.abs(rent - usd) < 0.5} onClick={() => { setRent(usd); setRentText(null); }} className={pill(Math.abs(rent - usd) < 0.5)}>
                  {money(usd)}
                </button>
              ))}
            </div>
            {cdf ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="inline-flex w-fit rounded-full border border-line bg-canvas-alt p-0.5" role="group" aria-label={labels.currencyLabel}>
                  {[['usd', 'USD $'], ['cdf', 'CDF FC']].map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={currency === value}
                      onClick={() => switchCurrency(value)}
                      className={cn('min-h-8 rounded-full px-3 text-[0.8125rem] font-semibold', currency === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-45')}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <p className="u-micro text-ink-45">{fill(labels.rateNote, { rate: fmtNum(cdf), date: rate.dateLabel })}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <span className="u-eyebrow text-ink-45">{labels.askedLabel}</span>
            <div className="flex flex-wrap gap-1.5 pb-1" role="group" aria-label={labels.presets}>
              {DEPOSIT_PRESETS.map((p) => (
                <button key={p.join('+')} type="button" aria-pressed={presetKey === p.join('+')} onClick={() => setMonths({ deposit: p[0], advance: p[1], commission: p[2] })} className={pill(presetKey === p.join('+'))}>
                  {p.join('+')}
                </button>
              ))}
            </div>
            <Stepper id="deposit-calc-g" kind="deposit" label={labels.deposit} color="var(--blue)" value={months.deposit} onChange={setMonth('deposit')} labels={labels} display={(v) => fmtNum(v)} />
            <Stepper id="deposit-calc-a" kind="advance" label={labels.advance} color="var(--brass)" value={months.advance} onChange={setMonth('advance')} labels={labels} display={(v) => fmtNum(v)} />
            <Stepper id="deposit-calc-c" kind="commission" label={labels.commission} color="#7c3aad" value={months.commission} onChange={setMonth('commission')} labels={labels} display={(v) => fmtNum(v, 1)} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 px-4 py-4 sm:px-6" aria-live="polite">
          {result ? (
            <>
              <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-canvas-alt p-3">
                  <span className="u-eyebrow text-ink-45">{labels.askedTotal}</span>
                  <span className="u-tabular whitespace-nowrap text-[1.5rem] font-extrabold leading-tight text-ink sm:text-[1.75rem]">{money(result.askedTotal)}</span>
                  <span className="u-micro text-ink-45">
                    {fill(labels.monthsOfRent, { months: fmtNum(result.askedTotal / rent, 1) })} · {fill(labels.refundable, { amount: money(result.asked.deposit) })}
                  </span>
                </div>
                <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-green-tint p-3">
                  <span className="u-eyebrow text-green-ink">{labels.legalTotal}</span>
                  <span className="u-tabular whitespace-nowrap text-[1.5rem] font-extrabold leading-tight text-ink sm:text-[1.75rem]">{money(result.legalTotal)}</span>
                  <span className="u-micro text-ink-45">
                    {fill(labels.monthsOfRent, { months: fmtNum(result.legalTotal / rent, 1) })} · {fill(labels.refundable, { amount: money(result.legal.deposit) })}
                  </span>
                </div>
              </div>

              {result.excess > 0.5 ? (
                <p className="rounded-xl bg-danger-tint px-3.5 py-3 text-[0.9375rem] leading-snug text-ink">
                  {fill(labels.excess, { amount: money(result.excess), months: fmtNum(result.excessMonths, 1) })}
                </p>
              ) : (
                <p className="rounded-xl bg-green-tint px-3.5 py-3 text-[0.9375rem] leading-snug text-green-ink">{labels.withinLaw}</p>
              )}

              <div className="flex flex-col gap-3">
                <Bar parts={result.asked} max={max} label={labels.barAsked} total={money(result.askedTotal)} over={{ deposit: result.over.deposit, extraAdvance: true }} />
                <Bar parts={result.legal} max={max} label={labels.barLaw} total={money(result.legalTotal)} />
              </div>

              <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full border-collapse text-[0.8125rem] sm:text-[0.875rem]">
                <thead>
                  <tr className="u-eyebrow text-ink-45">
                    <th scope="col" className="pb-1.5 text-left font-semibold">{labels.colItem}</th>
                    <th scope="col" className="pb-1.5 text-right font-semibold">{labels.colAsked}</th>
                    <th scope="col" className="pb-1.5 pl-3 text-right font-semibold">{labels.colLaw}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t border-line align-top">
                      <th scope="row" className="py-2 pr-2 text-left font-normal">
                        <span className="flex items-center gap-2 font-semibold text-ink">
                          <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px]" style={{ background: SEGMENTS.find((s) => s.key === row.key).color }} />
                          {row.name}
                        </span>
                        <span className="u-micro block pl-5 text-ink-45">{row.sub}</span>
                        <span className="block pl-5 pt-1"><Tag tone={row.tag}>{tagText[row.tag]}</Tag></span>
                      </th>
                      <td className="u-tabular whitespace-nowrap py-2 text-right text-ink">{money(row.a, { approx: false })}</td>
                      <td className="u-tabular whitespace-nowrap py-2 pl-3 text-right text-green-ink">{money(row.l, { approx: false })}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ink-70 font-bold">
                    <th scope="row" className="py-2 text-left text-ink">{labels.rowTotal}</th>
                    <td className="u-tabular whitespace-nowrap py-2 text-right text-ink">{money(result.askedTotal, { approx: false })}</td>
                    <td className="u-tabular whitespace-nowrap py-2 pl-3 text-right text-green-ink">{money(result.legalTotal, { approx: false })}</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </>
          ) : (
            <p className="rounded-xl bg-canvas-alt px-3.5 py-3 text-[0.9375rem] text-ink-70">{labels.enterRent}</p>
          )}
        </div>
      </div>
      <p className="u-micro border-t border-line px-4 py-3 text-ink-45 sm:px-6">{labels.footnote}</p>
    </section>
  );
}
