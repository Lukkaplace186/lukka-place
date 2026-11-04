'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import QueryAlertButton from './QueryAlertButton';
import { budgetLabels } from './SearchBar';
import { budgetOptions, budgetParams } from '@/lib/budgetSteps';
import { homeAlertQuery } from '@/lib/homeAlert';
import { useT } from '@/lib/i18n/client';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const FIELD_BOX =
  'relative flex min-h-12 min-w-0 items-center gap-2 rounded-xl border border-ink-25 bg-surface px-4 transition-colors ' +
  'focus-within:border-blue focus-within:shadow-[0_0_0_3px_var(--blue-tint)]';
const FIELD_SELECT =
  'min-w-0 flex-1 cursor-pointer truncate appearance-none bg-transparent py-3 text-[0.9375rem] text-ink focus:outline-none';
const LABEL = 'mb-1.5 block text-[0.875rem] font-semibold text-ink';

/**
 * The homepage alert: Louer | Acheter, a commune, a maximum budget, then
 * QueryAlertButton (signup with the search kept, or the confirmation when
 * signed in). Kinshasa communes only, the communes with listings first with
 * their real counts; the button appears once a commune is picked, since an
 * alert on a whole city's rentals is a feed, not an alert.
 *
 * @param {{popular: {commune: string, count: number}[], others: string[]}} props
 */
export default function HomeAlertPicker({ popular = [], others = [] }) {
  const t = useT();
  const [transaction, setTransaction] = useState('location');
  const [commune, setCommune] = useState('');
  const [budgetMax, setBudgetMax] = useState('');

  const { maxOptions } = useMemo(() => {
    const { format, labels } = budgetLabels(t);
    return budgetOptions(transaction, { min: '', max: budgetMax }, format, labels);
  }, [t, transaction, budgetMax]);

  const query = homeAlertQuery({ transaction, commune, ...budgetParams('', budgetMax) });

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={t('home.search.transactionType')} className="grid grid-cols-2 gap-1 rounded-xl bg-canvas-alt p-1">
        {[
          ['location', t('home.search.rent')],
          ['vente', t('home.search.buy')],
        ].map(([value, label]) => {
          const on = transaction === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                if (on) return;
                setTransaction(value);
                // Rent and sale budgets are different scales.
                setBudgetMax('');
              }}
              className={`u-press min-h-11 rounded-lg text-[0.9375rem] font-semibold transition-colors ${
                on ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-ink-45 hover:text-ink'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="home-alert-commune" className={LABEL}>{t('home.alertBand.commune')}</label>
          <div className={FIELD_BOX}>
            <select id="home-alert-commune" value={commune} onChange={(e) => setCommune(e.target.value)} className={FIELD_SELECT}>
              <option value="">{t('home.alertBand.communePlaceholder')}</option>
              {popular.length ? (
                <optgroup label={t('home.alertBand.withListings')}>
                  {popular.map(({ commune: name, count }) => (
                    <option key={name} value={name}>{`${name} (${count})`}</option>
                  ))}
                </optgroup>
              ) : null}
              {others.length ? (
                <optgroup label={t('home.alertBand.otherCommunes')}>
                  {others.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor="home-alert-budget" className={LABEL}>{t('home.alertBand.budget')}</label>
          <div className={FIELD_BOX}>
            <select id="home-alert-budget" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} className={FIELD_SELECT}>
              {maxOptions.map(({ value, label, disabled }) => (
                <option key={value} value={value} disabled={disabled}>{label}</option>
              ))}
            </select>
            <ChevronDown strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="pointer-events-none h-4 w-4 shrink-0 text-ink-45" />
          </div>
        </div>
      </div>

      {query ? (
        <QueryAlertButton query={query} label={t('home.alertBand.button')} fullWidth />
      ) : (
        <p className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-ink-25 px-4 text-center text-[0.875rem] text-ink-45">
          {t('home.alertBand.pickCommune')}
        </p>
      )}
    </div>
  );
}
