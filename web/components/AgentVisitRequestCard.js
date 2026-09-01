'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, MapPin, Clock, Check, X, CalendarClock } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { updateViewingRequestAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

const STATUS_TAG = {
  PENDING: 'bg-warning-tint text-warning',
  CONFIRMED: 'bg-success-tint text-success',
  RESCHEDULED: 'bg-blue-tint text-blue-deep',
  CANCELLED: 'bg-canvas-deep text-ink-45',
};

/**
 * Confirm/Cancel are single-click; Reprogrammer expands an inline free-text
 * input for the new proposed time (same "expand inline" shape
 * AgentLeadCard's reply composer already uses) since a reschedule needs a
 * real value, not just a status flip. Calls updateViewingRequestAction
 * imperatively so this card can show a toast and stay in place — no
 * navigation, per this feature's ask.
 */
export default function AgentVisitRequestCard({ viewingRequest, statusLabel, relativeTime, target }) {
  const [reschedule, setReschedule] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const name = viewingRequest.lead_name || viewingRequest.lead_wa_id;

  function run(status, requestedTime) {
    const formData = new FormData();
    formData.set('status', status);
    if (requestedTime !== undefined) formData.set('requested_time', requestedTime);

    startTransition(async () => {
      const result = await updateViewingRequestAction(viewingRequest.id, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      const messages = {
        CONFIRMED: 'Visite confirmée.',
        CANCELLED: 'Visite annulée.',
        RESCHEDULED: 'Nouveau créneau proposé.',
      };
      showToast({ type: 'success', message: messages[status] || 'Demande mise à jour.' });
      setReschedule(false);
      setNewTime('');
      router.refresh();
    });
  }

  function submitReschedule(event) {
    event.preventDefault();
    if (!newTime.trim()) return;
    run('RESCHEDULED', newTime.trim());
  }

  return (
    <div className="u-card rounded-card bg-surface p-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold text-ink">{name}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.12em] ${
                STATUS_TAG[viewingRequest.status] || STATUS_TAG.PENDING
              }`}
            >
              {statusLabel}
            </span>
            <span className="text-xs text-ink-35">{relativeTime}</span>
          </div>

          <div className="mt-3.5 flex flex-wrap gap-x-[1.125rem] gap-y-2 border-t border-line pt-3.5 text-[0.8125rem] text-ink-70">
            <span className="inline-flex items-center gap-1.5">
              <Clock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
              {viewingRequest.requested_time || 'Créneau non précisé'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
              {viewingRequest.lead_wa_id}
            </span>
            {target && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" />
                <span className="truncate">{target}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => run('CONFIRMED')}
            className="u-btn-primary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue text-sm font-bold text-white disabled:opacity-60"
          >
            <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Confirmer
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setReschedule((v) => !v)}
              aria-expanded={reschedule}
              className="u-press inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[0.8125rem] font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink disabled:opacity-60"
            >
              <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              Reprogrammer
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run('CANCELLED')}
              className="u-press inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[0.8125rem] font-semibold text-danger transition-colors hover:bg-danger-tint disabled:opacity-60"
            >
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              Annuler
            </button>
          </div>
        </div>
      </div>

      {reschedule && (
        <form onSubmit={submitReschedule} className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor={`reschedule-${viewingRequest.id}`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              Nouveau créneau proposé
            </label>
            <input
              id={`reschedule-${viewingRequest.id}`}
              type="text"
              required
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              placeholder="Ex. Samedi matin, 10h"
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
          >
            {pending ? 'Envoi…' : 'Proposer ce créneau'}
          </button>
        </form>
      )}
    </div>
  );
}
