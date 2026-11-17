'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BedDouble, ChevronDown, Wallet } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { frNumber } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { budgetOptions, budgetParams } from '@/lib/budgetSteps';
import {
  MAP_BED_STEPS,
  bedsRangeLabel,
  bedsRangeParams,
  mapFilterHrefMany,
  priceRangeLabel,
  transactionHref,
} from '@/lib/mapQuickFilters';

function Chip({ active, icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'u-press pointer-events-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold',
        // On the liquid-glass panel (ListingsSplitView): a lighter pane of glass.
        active ? 'bg-ink text-white' : 'u-liquid-glass-field text-ink',
      )}
    >
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
      <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
    </button>
  );
}

/** Louer | Acheter as one glass pill; the chosen half is dark. */
function TransactionToggle({ value, onPick, t }) {
  const option = (key, label) => (
    <button
      type="button"
      aria-pressed={value === key}
      onClick={() => onPick(key)}
      className={cn(
        'u-press h-full rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors',
        value === key ? 'bg-ink text-white' : 'text-ink',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="u-liquid-glass-field pointer-events-auto inline-flex h-9 shrink-0 items-center rounded-full p-0.5">
      {option('location', t('nav.rent'))}
      {option('vente', t('nav.buy'))}
    </div>
  );
}

function RangeSelect({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-[0.75rem] font-semibold uppercase tracking-wide text-ink-45">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-xl border border-line bg-surface px-3 text-[0.9375rem] font-semibold text-ink"
      >
        {options.map((o) => (
          <option key={o.value || 'any'} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Louer / Acheter · Prix · Chambres under the phone map's search (2026-10-06
 * storefront upgrade; ranges and Louer/Acheter 2026-11-17, owner). Prix and
 * Chambres open a bottom sheet with a "from" and a "to" — "350 $ to 650 $",
 * "2 to 3 chambres" — applied together with one button, so the map refetches
 * once. Louer / Acheter applies at once. The property type stays in the full
 * filter sheet behind the sliders button.
 *
 * Read from and written to the live query string (`transaction_type`,
 * `price_min`/`price_max`, `beds_min`/`beds_max`), so every other filter and
 * the map area (`sw_lat…`) survive; `page` is dropped, as FilterBar does.
 */
export default function MapQuickFilters({ params = {} }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({ min: '', max: '' });
  const money = (n) => (t.locale === 'en' ? Number(n).toLocaleString('en-GB') : frNumber(Number(n)));
  const transaction = params.transaction_type || '';

  function go(updates) {
    setOpen(null);
    router.push(mapFilterHrefMany(window.location.search, updates), { scroll: false });
  }

  function openSheet(kind) {
    setDraft(kind === 'price'
      ? { min: params.price_min || '', max: params.price_max || '' }
      : { min: params.beds_min || '', max: params.beds_max || '' });
    setOpen(kind);
  }

  const priceOptions = useMemo(() => budgetOptions(transaction, open === 'price' ? draft : {}, money, {
    minAny: t('home.search.budgetMinAny'),
    maxAny: t('home.search.budgetMaxAny'),
    min: (amount) => t('home.search.budgetMin', { amount }),
    max: (amount) => t('home.search.budgetMax', { amount }),
    over: (amount) => t('home.search.budgetOver', { amount }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [t, transaction, open, draft]);

  const bedLo = Number.parseInt(draft.min, 10);
  const bedHi = Number.parseInt(draft.max, 10);
  const bedMinOptions = [
    { value: '', label: t('listings.filters.min') },
    ...MAP_BED_STEPS.map((b) => ({ value: String(b), label: `${b} ch.`, disabled: Number.isFinite(bedHi) && b > bedHi })),
  ];
  const bedMaxOptions = [
    { value: '', label: t('listings.filters.max') },
    ...MAP_BED_STEPS.map((b) => ({ value: String(b), label: `${b} ch.`, disabled: Number.isFinite(bedLo) && b < bedLo })),
  ];

  const priceText = priceRangeLabel(params.price_min, params.price_max, money);
  const bedsText = bedsRangeLabel(params.beds_min, params.beds_max);

  return (
    <>
      <div className="no-scrollbar -mx-2.5 mt-2 flex gap-2 overflow-x-auto px-2.5 pb-1 lg:hidden">
        <TransactionToggle
          value={transaction}
          t={t}
          onPick={(key) => router.push(transactionHref(window.location.search, transaction, key), { scroll: false })}
        />
        <Chip active={Boolean(priceText)} icon={Wallet} onClick={() => openSheet('price')}>
          {priceText || t('listings.map.quick.price')}
        </Chip>
        <Chip active={Boolean(bedsText)} icon={BedDouble} onClick={() => openSheet('beds')}>
          {bedsText || t('listings.map.quick.beds')}
        </Chip>
      </div>

      <Sheet open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl border-line bg-surface p-0 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:hidden">
          {open ? (
            <>
              <SheetHeader className="px-4 pb-1 pt-5">
                <SheetTitle className="text-[1.0625rem] font-bold text-ink">
                  {open === 'price' ? t('listings.map.quick.price') : t('listings.map.quick.beds')}
                </SheetTitle>
              </SheetHeader>
              <div className="flex gap-3 px-4 pt-2">
                {open === 'price' ? (
                  <>
                    <RangeSelect label={t('listings.filters.min')} value={draft.min} options={priceOptions.minOptions} onChange={(min) => setDraft((d) => ({ ...d, min }))} />
                    <RangeSelect label={t('listings.filters.max')} value={draft.max} options={priceOptions.maxOptions} onChange={(max) => setDraft((d) => ({ ...d, max }))} />
                  </>
                ) : (
                  <>
                    <RangeSelect label={t('listings.filters.min')} value={draft.min} options={bedMinOptions} onChange={(min) => setDraft((d) => ({ ...d, min }))} />
                    <RangeSelect label={t('listings.filters.max')} value={draft.max} options={bedMaxOptions} onChange={(max) => setDraft((d) => ({ ...d, max }))} />
                  </>
                )}
              </div>
              <div className="flex gap-3 px-4 pt-4">
                <button
                  type="button"
                  onClick={() => go(open === 'price' ? { price_min: '', price_max: '' } : { beds_min: '', beds_max: '' })}
                  className="u-press h-12 flex-1 rounded-full text-[0.9375rem] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--ink-25)]"
                >
                  {t('listings.map.quick.any')}
                </button>
                <button
                  type="button"
                  onClick={() => go(open === 'price' ? budgetParams(draft.min, draft.max) : bedsRangeParams(draft.min, draft.max))}
                  className="u-press u-btn-primary h-12 flex-[2] rounded-full bg-blue text-[0.9375rem] font-semibold text-white"
                >
                  {t('listings.filters.apply')}
                </button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
