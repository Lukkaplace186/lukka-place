'use client';

import { useMemo, useState } from 'react';
import { paymentSchedule } from '@/lib/developmentRules';
import { useT } from '@/lib/i18n/client';

function usd(amount) {
  return `${Math.round(amount).toLocaleString('fr-FR')} $`;
}

/**
 * The developer's payment plan, and what each instalment comes to for a unit
 * the visitor picks. Only the developer's own percentages and prices are
 * used — no financing, no interest, no invented fees (web/CLAUDE.md, "/plan
 * stays an honest empty page": we have no rates to compute with). A custom
 * amount is allowed for a buyer negotiating a price that is not listed.
 *
 * @param {{plan: Array<{label: string, percent: number}>, options: Array<{id: string, label: string, price: number}>}} props
 */
export default function PaymentPlan({ plan, options }) {
  const t = useT();
  const [choice, setChoice] = useState(options[0]?.id ?? 'custom');
  const [custom, setCustom] = useState('');

  const price = choice === 'custom'
    ? Number(String(custom).replace(/[^\d.]/g, '')) || null
    : options.find((o) => o.id === choice)?.price ?? null;
  const schedule = useMemo(() => paymentSchedule(plan, price), [plan, price]);

  return (
    <section className="flex flex-col gap-3" id="paiement">
      <h2 className="u-title-section text-ink">{t('projects.plan.title')}</h2>
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <ol className="flex flex-col gap-2">
          {plan.map((row, index) => (
            <li key={`${row.label}-${index}`} className="flex items-center gap-3">
              <span className="u-tabular inline-flex h-9 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-tint text-sm font-bold text-blue-deep">
                {row.percent}%
              </span>
              <span className="text-sm text-ink">{row.label}</span>
            </li>
          ))}
        </ol>

        <div className="h-px bg-line" />

        <div className="flex flex-col gap-2">
          <label htmlFor="plan-unit" className="u-micro-strong text-ink">{t('projects.plan.simulate')}</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id="plan-unit"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.label} — {usd(option.price)}</option>
              ))}
              <option value="custom">{t('projects.plan.customOption')}</option>
            </select>
            {choice === 'custom' ? (
              <input
                inputMode="numeric"
                value={custom}
                onChange={(event) => setCustom(event.target.value)}
                placeholder={t('projects.plan.customPlaceholder')}
                aria-label={t('projects.plan.customPlaceholder')}
                className="min-h-11 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
              />
            ) : null}
          </div>
        </div>

        {schedule.length ? (
          <table className="w-full text-sm">
            <tbody>
              {schedule.map((row, index) => (
                <tr key={`${row.label}-${index}`} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 text-ink-70">{row.label} <span className="text-ink-45">({row.percent}%)</span></td>
                  <td className="u-tabular py-2 text-right font-semibold text-ink">{usd(row.amount)}</td>
                </tr>
              ))}
              <tr>
                <td className="pt-2 font-semibold text-ink">{t('projects.plan.total')}</td>
                <td className="u-tabular pt-2 text-right font-bold text-ink">{usd(price)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-45">{t('projects.plan.pickPrice')}</p>
        )}
        <p className="text-[0.75rem] leading-relaxed text-ink-45">{t('projects.plan.disclaimer')}</p>
      </div>
    </section>
  );
}
