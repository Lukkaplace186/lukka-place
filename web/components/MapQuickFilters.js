'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BedDouble, Building2, ChevronDown, Wallet } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { MAP_BED_STEPS, MAP_PRICE_STEPS, mapFilterHref } from '@/lib/mapQuickFilters';

function Chip({ active, icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'u-press u-lift pointer-events-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold',
        active ? 'bg-ink text-white' : 'bg-surface text-ink',
      )}
    >
      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
      <ChevronDown strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
    </button>
  );
}

function Option({ on, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'u-press inline-flex min-h-11 items-center rounded-full px-4 text-[0.875rem] font-semibold',
        on ? 'bg-ink text-white' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--ink-25)]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Prix · Chambres · Type chips under the phone map's search (2026-10-06
 * storefront upgrade). Each opens a small bottom sheet and applies straight
 * to the URL, so a visitor narrows the map without leaving it for the full
 * filter sheet (which the sliders button beside the search still opens).
 *
 * Same params as FilterBar (`price_max`, `beds_min`, `property_type`), read
 * from and written to the live query string, so every other filter and the
 * map area (`sw_lat…`, root CLAUDE.md "Viewport fetching") survive — a
 * non-location change keeps the view. `page` is dropped, as FilterBar does.
 * Property types are the real facets the page already loads
 * (getPropertyTypeFacets), never a hardcoded list.
 */
export default function MapQuickFilters({ params = {}, propertyTypes = [] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(null);
  const money = (n) => Number(n).toLocaleString(t.locale === 'en' ? 'en-GB' : 'fr-FR');
  const typeLabel = propertyTypes.find((o) => o.value === params.property_type)?.label;

  function apply(key, value) {
    setOpen(null);
    router.push(mapFilterHref(window.location.search, key, value), { scroll: false });
  }

  const sheets = {
    price: {
      title: t('listings.map.quick.priceTitle'),
      options: [{ value: '', label: t('listings.map.quick.any') }, ...MAP_PRICE_STEPS.map((p) => ({ value: String(p), label: `≤ ${money(p)} $` }))],
      current: params.price_max || '',
      key: 'price_max',
    },
    beds: {
      title: t('listings.map.quick.bedsTitle'),
      options: [{ value: '', label: t('listings.map.quick.any') }, ...MAP_BED_STEPS.map((b) => ({ value: String(b), label: `${b}+` }))],
      current: params.beds_min || '',
      key: 'beds_min',
    },
    type: {
      title: t('listings.map.quick.typeTitle'),
      options: [{ value: '', label: t('listings.map.quick.any') }, ...propertyTypes.map((o) => ({ value: o.value, label: o.label }))],
      current: params.property_type || '',
      key: 'property_type',
    },
  };
  const sheet = open ? sheets[open] : null;

  return (
    <>
      <div className="no-scrollbar -mx-2.5 mt-2 flex gap-2 overflow-x-auto px-2.5 pb-1 lg:hidden">
        <Chip active={Boolean(params.price_max)} icon={Wallet} onClick={() => setOpen('price')}>
          {params.price_max ? `≤ ${money(params.price_max)} $` : t('listings.map.quick.price')}
        </Chip>
        <Chip active={Boolean(params.beds_min)} icon={BedDouble} onClick={() => setOpen('beds')}>
          {params.beds_min ? t('listings.map.quick.bedsValue', { count: Number(params.beds_min) }) : t('listings.map.quick.beds')}
        </Chip>
        {propertyTypes.length > 1 ? (
          <Chip active={Boolean(params.property_type)} icon={Building2} onClick={() => setOpen('type')}>
            {typeLabel || t('listings.map.quick.type')}
          </Chip>
        ) : null}
      </div>

      <Sheet open={Boolean(sheet)} onOpenChange={(next) => !next && setOpen(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl border-line bg-surface p-0 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:hidden">
          {sheet ? (
            <>
              <SheetHeader className="px-4 pb-1 pt-5">
                <SheetTitle className="text-[1.0625rem] font-bold text-ink">{sheet.title}</SheetTitle>
              </SheetHeader>
              <div className="flex flex-wrap gap-2 px-4 pt-2">
                {sheet.options.map((o) => (
                  <Option key={o.value || 'any'} on={sheet.current === o.value} onClick={() => apply(sheet.key, o.value)}>
                    {o.label}
                  </Option>
                ))}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
