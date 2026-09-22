'use client';

import { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { fromKinshasaInputs, kinshasaDayKey, toKinshasaInputs, validateAgreedSlot } from '@/lib/visitAgenda';
import { useT } from '@/lib/i18n/client';

/**
 * Date + time, in Kinshasa time, for one visit — the confirm step (the agreed
 * instant becomes `scheduled_at`) and the "propose another slot" step (the
 * instant becomes the French phrase the customer reads).
 *
 * Both fields are required: a day with no hour is refused here and again by
 * the Server Action and the engine, never filled in with a morning nobody
 * agreed to. `prefill` is the engine's own reading of what the customer asked
 * for (or the agent's earlier proposal) and only ever a starting point — the
 * agent sees it and can change it before anything is sent.
 *
 * Only ever mounted after a tap, so reading the clock for `min` cannot cause a
 * hydration mismatch.
 *
 * @param {{ id: string|number, prefill?: string|null, submitLabel: string, pending?: boolean, onSubmit: (iso: string) => void, hint?: string }} props
 */
export default function VisitSlotForm({ id, prefill = null, submitLabel, pending = false, onSubmit, hint }) {
  const t = useT();
  const initial = toKinshasaInputs(prefill);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState(null);
  const today = kinshasaDayKey(new Date());

  function submit(event) {
    event.preventDefault();
    const iso = fromKinshasaInputs(date, time);
    if (!iso) {
      setError(t(date && !time ? 'agent.agenda.confirm.timeRequired' : 'agent.agenda.confirm.timeInvalid'));
      return;
    }
    const verdict = validateAgreedSlot(iso);
    if (verdict.errorKey) {
      setError(t(verdict.errorKey));
      return;
    }
    setError(null);
    onSubmit(verdict.value);
  }

  const field = 'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2.5">
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2.5">
        <div className="min-w-0">
          <label htmlFor={`slot-date-${id}`} className="u-micro-strong mb-1.5 block text-ink-70">
            {t('agent.agenda.confirm.dateLabel')}
          </label>
          <input
            id={`slot-date-${id}`}
            type="date"
            required
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={field}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={`slot-time-${id}`} className="u-micro-strong mb-1.5 block text-ink-70">
            {t('agent.agenda.confirm.timeLabel')}
          </label>
          <input
            id={`slot-time-${id}`}
            type="time"
            required
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={field}
          />
        </div>
      </div>
      <p className="u-micro text-ink-45">{hint || t('agent.agenda.confirm.kinshasaTime')}</p>
      {error && (
        <p className="u-micro font-semibold text-danger" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="u-btn-primary u-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60 sm:w-auto sm:self-start"
      >
        <CalendarCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {pending ? t('agent.agenda.sending') : submitLabel}
      </button>
    </form>
  );
}
