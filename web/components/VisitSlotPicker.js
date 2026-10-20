'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { formatVisitDay, formatVisitSlot, kinshasaDayKey, slotPhraseFr } from '@/lib/visitAgenda';
import { calendarWeeks, dayClosed, dayHasFreeSlot, slotsForDay, visitDays } from '@/lib/visitSlots';

/**
 * The visit calendar: a month-style grid of the next fourteen Kinshasa days
 * (Monday first), then a time — a dropdown of every quarter of an hour from
 * 08:00 to 20:00 (a native <select>: on a phone it is the system's own wheel,
 * and 49 times do not fit as buttons). It was four fixed slots.
 * Rules in lib/visitSlots.js: a slot less than two hours away, within an hour
 * of the agent's confirmed visits, or on a day the agent takes no visits is
 * greyed out, nothing else. Busy instants and days off come from
 * /api/listings/:id/visit-slots, fetched once per mount; while they load, or
 * if they fail, every slot is offered.
 *
 * It was a row of seven day chips (2026-09-29). A grid reads as a calendar,
 * shows two weeks without scrolling sideways, and lets a day the agent is
 * off be seen as off rather than merely missing.
 *
 * Controlled when `value` / `onChange` are given ("Mes visites"); with a
 * `name` it also posts `<name>` (the ISO instant, +01:00) and
 * `requested_time` (the French phrase every agent message already shows).
 */
// A native select with our own chevron (appearance-none removes the system one).
const SELECT_CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.75rem center',
  paddingRight: '2.25rem',
};

export default function VisitSlotPicker({ propertyId, value, onChange, name, idPrefix = 'visit-slot' }) {
  const t = useT();
  const locale = useLocale();
  // Rendered only inside a dialog or sheet opened in the browser — never on
  // the server — so reading the clock here cannot cause a hydration mismatch.
  const [now] = useState(() => new Date());
  const [busy, setBusy] = useState([]);
  const [availability, setAvailability] = useState(null);
  // The listing's clock (+1 Kinshasa, +2 Lubumbashi, Goma…), from the slots API.
  const [utcOffset, setUtcOffset] = useState(1);
  const [internal, setInternal] = useState(null);
  const selected = value !== undefined ? value : internal;
  const [day, setDay] = useState(() => (selected ? kinshasaDayKey(selected) : null));

  useEffect(() => {
    if (!propertyId) return undefined;
    let live = true;
    fetch(`/api/listings/${propertyId}/visit-slots`)
      .then((res) => (res.ok ? res.json() : { busy: [] }))
      .then((data) => {
        if (!live) return;
        if (Array.isArray(data?.busy)) setBusy(data.busy);
        setAvailability({ closedWeekdays: data?.closedWeekdays || [], blockedDates: data?.blockedDates || [] });
        if (data?.utcOffset === 2) setUtcOffset(2);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [propertyId]);

  const days = useMemo(() => visitDays(now), [now]);
  const weeks = useMemo(() => calendarWeeks(now), [now]);
  const rules = { now, busy, availability, utcOffset };
  const activeDay = (day && dayHasFreeSlot(day, rules) ? day : null) || days.find((d) => dayHasFreeSlot(d, rules)) || days[0];
  const slots = activeDay ? slotsForDay(activeDay, rules) : [];
  // The select shows the pick only on the day it belongs to; on another day it
  // goes back to "choose a time" while the pick itself stays until replaced.
  const selectedOnDay = selected && slots.some((slot) => slot.iso === selected) ? selected : '';

  function choose(iso) {
    if (value === undefined) setInternal(iso);
    onChange?.(iso);
  }

  const REASONS = { busy: 'enquiry.picker.busy', past: 'enquiry.picker.tooSoon', closed: 'enquiry.picker.closed' };
  const reasonText = (reason) => (REASONS[reason] ? t(REASONS[reason]) : undefined);

  const tag = locale === 'en' ? 'en-GB' : 'fr-FR';
  // Monday-first weekday initials, in the reader's language.
  const weekdayNames = useMemo(() => {
    const monday = Date.UTC(2024, 0, 1, 12); // a Monday
    const format = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(monday + i * 86400000)).replace('.', ''));
  }, [tag]);
  const monthLabel = useMemo(() => {
    const format = new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' });
    const first = format.format(new Date(`${days[0]}T12:00:00+01:00`));
    const last = format.format(new Date(`${days[days.length - 1]}T12:00:00+01:00`));
    return first === last ? first : `${first} – ${last}`;
  }, [tag, days]);
  const dayLabel = (key) => formatVisitDay(`${key}T12:00:00+01:00`, locale);
  const dayNote = (key) => t(availability && dayClosed(key, availability) ? 'enquiry.picker.closed' : 'enquiry.picker.dayFull');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {name ? (
        <>
          <input type="hidden" name={name} value={selected || ''} />
          <input type="hidden" name="requested_time" value={selected ? slotPhraseFr(selected) : ''} />
        </>
      ) : null}

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <p id={`${idPrefix}-day`} className="text-[0.8125rem] font-semibold text-ink-70">{t('enquiry.picker.day')}</p>
          <p className="text-[0.8125rem] font-semibold capitalize text-ink">{monthLabel}</p>
        </div>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-day`} className="rounded-xl bg-canvas-alt p-2">
          <div aria-hidden="true" className="grid grid-cols-7 gap-1 pb-1">
            {weekdayNames.map((name) => (
              <span key={name} className="text-center text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-45">{name}</span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week.find(Boolean)} className="grid grid-cols-7 gap-1 pt-1">
              {week.map((key, i) => {
                if (!key) return <span key={`blank-${i}`} aria-hidden="true" />;
                const free = dayHasFreeSlot(key, rules);
                const active = key === activeDay;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={free ? dayLabel(key) : `${dayLabel(key)} — ${dayNote(key)}`}
                    title={free ? undefined : dayNote(key)}
                    disabled={!free}
                    onClick={() => setDay(key)}
                    className={cn(
                      'u-press u-tabular relative flex h-11 items-center justify-center rounded-lg text-sm font-semibold',
                      active && 'bg-blue text-white',
                      !active && free && 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]',
                      !free && 'cursor-not-allowed text-ink-35 line-through',
                    )}
                  >
                    {Number(key.slice(8))}
                    {key === days[0] ? (
                      <span aria-hidden="true" className={cn('absolute bottom-1 h-1 w-1 rounded-full', active ? 'bg-white' : 'bg-blue')} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[0.8125rem] font-semibold text-ink first-letter:uppercase" aria-live="polite">
          {activeDay === days[0] ? `${t('enquiry.picker.today')} · ` : activeDay === days[1] ? `${t('enquiry.picker.tomorrow')} · ` : ''}
          {dayLabel(activeDay)}
        </p>
      </div>

      <div>
        <p id={`${idPrefix}-time`} className="mb-1.5 text-[0.8125rem] font-semibold text-ink-70">
          {t('enquiry.picker.time')} <span className="font-normal text-ink-45">· {t('enquiry.picker.kinshasaTime')}</span>
        </p>
        <select
          id={`${idPrefix}-time-select`}
          aria-labelledby={`${idPrefix}-time`}
          value={selectedOnDay}
          onChange={(event) => choose(event.target.value || null)}
          className={cn(
            'u-focus-ring u-tabular h-12 w-full appearance-none rounded-lg border bg-surface px-3 text-base font-semibold',
            selectedOnDay ? 'border-blue text-ink' : 'border-line text-ink-45',
          )}
          style={SELECT_CHEVRON}
        >
          <option value="">{t('enquiry.picker.chooseTime')}</option>
          {[['morning', (time) => time < '12:00'], ['afternoon', (time) => time >= '12:00' && time < '18:00'], ['evening', (time) => time >= '18:00']].map(([part, inPart]) => (
            <optgroup key={part} label={t(`enquiry.picker.${part}`)}>
              {slots.filter((slot) => inPart(slot.time)).map((slot) => (
                <option key={slot.iso} value={slot.iso} disabled={slot.disabled}>
                  {slot.disabled ? `${slot.time} — ${reasonText(slot.reason)}` : slot.time}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {slots.some((s) => s.reason === 'busy') ? (
          <p className="mt-1.5 text-xs text-ink-45">{t('enquiry.picker.busyNote')}</p>
        ) : null}
        {availability && days.some((d) => dayClosed(d, availability)) ? (
          <p className="mt-1.5 text-xs text-ink-45">{t('enquiry.picker.closedNote')}</p>
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
