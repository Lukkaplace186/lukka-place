'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarOff, ChevronDown } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { actionFailureToast } from '@/lib/actionFailure';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useLocale, useT } from '@/lib/i18n/client';
import { visitDays, weekdayOf } from '@/lib/visitSlots';
import { saveVisitAvailabilityAction } from '@/app/compte/agent/visitAvailabilityActions';

// Monday first, as JavaScript weekdays (0 = Sunday).
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/**
 * "Jours sans visites" on the agent's agenda: the weekdays they never take
 * visits and single dates in the bookable window. The public visit calendar
 * greys those days out (lib/visitSlots.js `dayClosed`), so a customer cannot
 * ask for a day the agent already knows is impossible.
 *
 * It removes days and nothing else: the four daily slots stay the same for
 * everybody, and each request is still confirmed by the agent.
 *
 * `today` comes from the server so the first render matches what it sent.
 */
export default function AgentVisitAvailability({ initial, today }) {
  const t = useT();
  const locale = useLocale();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [weekdays, setWeekdays] = useState(() => new Set(initial.closedWeekdays));
  const [dates, setDates] = useState(() => new Set(initial.blockedDates));
  const [saved, setSaved] = useState({ weekdays: initial.closedWeekdays, dates: initial.blockedDates });

  const tag = locale === 'en' ? 'en-GB' : 'fr-FR';
  const days = useMemo(() => visitDays(new Date(`${today}T12:00:00+01:00`)), [today]);
  const weekdayName = useMemo(() => {
    const format = new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone: 'UTC' });
    // 2024-01-07 is a Sunday: index = JavaScript weekday.
    return (day) => format.format(new Date(Date.UTC(2024, 0, 7 + day, 12)));
  }, [tag]);
  const dateLabel = useMemo(() => {
    const format = new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Kinshasa' });
    return (key) => format.format(new Date(`${key}T12:00:00+01:00`));
  }, [tag]);

  const toggle = (setter, value) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  const dirty =
    [...weekdays].sort().join() !== [...saved.weekdays].sort().join() ||
    [...dates].sort().join() !== [...saved.dates].sort().join();

  const summary = (() => {
    const parts = WEEK.filter((d) => saved.weekdays.includes(d)).map(weekdayName);
    const upcoming = saved.dates.filter((d) => d >= today).length;
    if (upcoming > 0) parts.push(t('agent.agenda.availability.datesCount', { count: upcoming }));
    return parts.length ? parts.join(' · ') : t('agent.agenda.availability.none');
  })();

  function save() {
    const payload = { closedWeekdays: [...weekdays], blockedDates: [...dates] };
    startTransition(async () => {
      let result;
      try {
        result = await saveVisitAvailabilityAction(payload);
      } catch (error) {
        showToast(actionFailureToast(t, error, save));
        return;
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('agent.agenda.availability.failed') });
        return;
      }
      setSaved({ weekdays: result.closedWeekdays, dates: result.blockedDates });
      setWeekdays(new Set(result.closedWeekdays));
      setDates(new Set(result.blockedDates));
      showToast({ message: t('agent.agenda.availability.saved') });
    });
  }

  const chip = (active) =>
    cn(
      'u-press inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-[0.8125rem] font-semibold capitalize',
      active ? 'bg-ink text-white line-through' : 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]',
    );

  return (
    <section aria-labelledby="visit-availability-title" className="u-card rounded-card bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="visit-availability-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <CalendarOff strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-blue" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span id="visit-availability-title" className="u-title-sub block text-ink">{t('agent.agenda.availability.title')}</span>
          <span className="u-micro block truncate text-ink-45 first-letter:uppercase">{summary}</span>
        </span>
        <ChevronDown
          strokeWidth={ICON_STROKE_WIDTH}
          className={cn('h-5 w-5 flex-none text-ink-45 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div id="visit-availability-panel" className="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-3.5">
          <p className="u-micro text-ink-45">{t('agent.agenda.availability.lead')}</p>

          <div>
            <p className="u-micro-strong mb-2 text-ink-70">{t('agent.agenda.availability.weekdays')}</p>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {WEEK.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={weekdays.has(day)}
                  onClick={() => toggle(setWeekdays, day)}
                  className={chip(weekdays.has(day))}
                >
                  {weekdayName(day)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="u-micro-strong mb-2 text-ink-70">{t('agent.agenda.availability.dates')}</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
              {days.map((key) => {
                const weekdayOff = weekdays.has(weekdayOf(key));
                const active = weekdayOff || dates.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    disabled={weekdayOff}
                    onClick={() => toggle(setDates, key)}
                    className={cn(chip(active), weekdayOff && 'cursor-not-allowed opacity-50')}
                  >
                    {dateLabel(key)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="u-btn-primary u-press inline-flex min-h-11 items-center rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-50"
            >
              {pending ? t('agent.agenda.availability.saving') : t('agent.agenda.availability.save')}
            </button>
            <p className="u-micro text-ink-45">{t('agent.agenda.availability.note')}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
