'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { formatVisitDay, formatVisitSlot, kinshasaDayKey, slotPhraseFr } from '@/lib/visitAgenda';
import { dayHasFreeSlot, slotsForDay, visitDays } from '@/lib/visitSlots';

/**
 * Day chips (the next seven Kinshasa days) then four slots — 09:00, 11:00,
 * 14:00, 16:00. Rules in lib/visitSlots.js: a slot less than two hours away
 * or within an hour of the agent's confirmed visits is greyed out, nothing
 * else. Busy instants come from /api/listings/:id/visit-slots, fetched once
 * per mount; while they load, or if they fail, every slot is offered.
 *
 * Controlled when `value` / `onChange` are given ("Mes visites"); with a
 * `name` it also posts `<name>` (the ISO instant, +01:00) and
 * `requested_time` (the French phrase every agent message already shows).
 */
export default function VisitSlotPicker({ propertyId, value, onChange, name, idPrefix = 'visit-slot' }) {
  const t = useT();
  const locale = useLocale();
  // Rendered only inside a dialog or sheet opened in the browser — never on
  // the server — so reading the clock here cannot cause a hydration mismatch.
  const [now] = useState(() => new Date());
  const [busy, setBusy] = useState([]);
  const [internal, setInternal] = useState(null);
  const selected = value !== undefined ? value : internal;
  const [day, setDay] = useState(() => (selected ? kinshasaDayKey(selected) : null));

  useEffect(() => {
    if (!propertyId) return undefined;
    let live = true;
    fetch(`/api/listings/${propertyId}/visit-slots`)
      .then((res) => (res.ok ? res.json() : { busy: [] }))
      .then((data) => {
        if (live && Array.isArray(data?.busy)) setBusy(data.busy);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [propertyId]);

  const days = useMemo(() => visitDays(now), [now]);
  const activeDay = day || days.find((d) => dayHasFreeSlot(d, { now, busy })) || days[0];
  const slots = activeDay ? slotsForDay(activeDay, { now, busy }) : [];

  function choose(iso) {
    if (value === undefined) setInternal(iso);
    onChange?.(iso);
  }

  const label = (hour) => `${String(hour).padStart(2, '0')}:00`;
  const reasonText = (reason) => (reason === 'busy' ? t('enquiry.picker.busy') : reason === 'past' ? t('enquiry.picker.tooSoon') : undefined);

  const dayLabel = (key, index) => {
    if (index === 0) return t('enquiry.picker.today');
    if (index === 1) return t('enquiry.picker.tomorrow');
    return formatVisitDay(`${key}T12:00:00+01:00`, locale, { long: false });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {name ? (
        <>
          <input type="hidden" name={name} value={selected || ''} />
          <input type="hidden" name="requested_time" value={selected ? slotPhraseFr(selected) : ''} />
        </>
      ) : null}

      <div>
        <p id={`${idPrefix}-day`} className="mb-1.5 text-[0.8125rem] font-semibold text-ink-70">{t('enquiry.picker.day')}</p>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-day`} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {days.map((key, index) => {
            const free = dayHasFreeSlot(key, { now, busy });
            const active = key === activeDay;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!free}
                onClick={() => setDay(key)}
                className={cn(
                  'u-press min-h-11 flex-none rounded-full px-3.5 text-sm font-semibold capitalize',
                  active ? 'bg-ink text-white' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]',
                  !free && 'opacity-40',
                )}
              >
                {dayLabel(key, index)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p id={`${idPrefix}-time`} className="mb-1.5 text-[0.8125rem] font-semibold text-ink-70">
          {t('enquiry.picker.time')} <span className="font-normal text-ink-45">· {t('enquiry.picker.kinshasaTime')}</span>
        </p>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-time`} className="grid grid-cols-4 gap-1.5">
          {slots.map((slot) => {
            const active = selected === slot.iso;
            return (
              <button
                key={slot.iso}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={slot.disabled}
                title={reasonText(slot.reason)}
                aria-label={slot.disabled ? `${label(slot.hour)} — ${reasonText(slot.reason)}` : label(slot.hour)}
                onClick={() => choose(slot.iso)}
                className={cn(
                  'u-press u-tabular min-h-11 rounded-lg text-sm font-semibold',
                  active ? 'bg-blue text-white' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]',
                  slot.disabled && 'cursor-not-allowed text-ink-35 line-through opacity-60',
                )}
              >
                {label(slot.hour)}
              </button>
            );
          })}
        </div>
        {slots.some((s) => s.reason === 'busy') ? (
          <p className="mt-1.5 text-xs text-ink-45">{t('enquiry.picker.busyNote')}</p>
        ) : null}
      </div>

      {selected ? (
        <p className="rounded-lg bg-blue-tint px-3 py-2 text-sm font-semibold text-blue-deep" aria-live="polite">
          {t('enquiry.picker.chosen', { slot: formatVisitSlot(selected, locale) })}
        </p>
      ) : null}
    </div>
  );
}
