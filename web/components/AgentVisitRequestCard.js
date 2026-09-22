'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, MapPin, Clock, Check, X, CalendarClock, MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { updateViewingRequestAction } from '@/app/compte/agent/actions';
import { agentActionsFor } from '@/lib/viewingActions';
import { confirmPrefill } from '@/lib/visitAgenda';
import VisitSlotForm from './VisitSlotForm';
import { useToast } from './Toast';
import { isNetworkError } from '@/lib/networkError';
import { useT } from '@/lib/i18n/client';

const STATUS_TAG = {
  PENDING: 'bg-warning-tint text-warning',
  CONFIRMED: 'bg-success-tint text-success',
  RESCHEDULED: 'bg-blue-tint text-blue-deep',
  CANCELLED: 'bg-canvas-deep text-ink-45',
  DECLINED: 'bg-danger-tint text-danger',
  COMPLETED: 'bg-success-tint text-success',
};

const SECONDARY_BUTTON =
  'u-press inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[0.8125rem] font-semibold transition-colors disabled:opacity-60';

/**
 * One viewing request, with only the answers its status allows
 * (lib/viewingActions.js): Confirmer / Reprogrammer / Décliner before a visit is
 * agreed, Reprogrammer / Annuler la visite after, nothing once it is settled.
 * The card used to offer Confirm on every row, including confirmed ones, and a
 * second confirmation messages the customer a second time.
 *
 * Every answer goes through updateViewingRequestAction, which now reaches the
 * customer on WhatsApp. The toast says whether that message actually left — an
 * agent who believes the client was told when they were not will not follow up
 * themselves. Reprogrammer expands an inline free-text input, since a new slot
 * needs a real value.
 */
export default function AgentVisitRequestCard({ viewingRequest, statusLabel, relativeTime, target }) {
  const t = useT();
  const [reschedule, setReschedule] = useState(false);
  // Confirm opens a date + time step: a dashboard confirmation must carry the
  // agreed instant (lib/visitAgenda.js, "`scheduled_at`" in root CLAUDE.md).
  const [confirming, setConfirming] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const name = viewingRequest.lead_name || viewingRequest.lead_wa_id;
  const actions = agentActionsFor(viewingRequest.status);
  const can = (status) => actions.includes(status);

  const doneMessage = {
    CONFIRMED: t('agent.visits.confirmed'),
    RESCHEDULED: t('agent.visits.rescheduled'),
    DECLINED: t('agent.visits.declined'),
    CANCELLED: t('agent.visits.cancelled'),
  };

  function run(status, requestedTime, scheduledAt) {
    const formData = new FormData();
    formData.set('status', status);
    if (requestedTime !== undefined) formData.set('requested_time', requestedTime);
    if (scheduledAt !== undefined) formData.set('scheduled_at', scheduledAt);

    startTransition(async () => {
      let result;
      try {
        result = await updateViewingRequestAction(viewingRequest.id, formData);
      } catch (err) {
        // A rejected Server Action (expired session, dropped connection) is not
        // an {ok:false}; without this the buttons would simply go dead.
        console.error('[AgentVisitRequestCard] updateViewingRequestAction failed', err);
        // A dropped connection on a site visit is the common case, and it is
        // safe to retry: the engine ignores a repeated status.
        if (isNetworkError(err)) {
          showToast({
            type: 'error',
            message: t('common.network.actionOffline'),
            action: { label: t('common.network.retry'), onClick: () => run(status, requestedTime, scheduledAt) },
          });
          return;
        }
        showToast({ type: 'error', message: t('errors.submissionFailed') });
        return;
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      if (result.unchanged) {
        showToast({ type: 'success', message: t('agent.visits.alreadyDone') });
      } else {
        const notice = result.tenantNotified ? t('agent.visits.clientNotified') : t('agent.visits.clientNotNotified');
        showToast({ type: result.tenantNotified ? 'success' : 'error', message: `${doneMessage[status]} ${notice}` });
      }
      setReschedule(false);
      setConfirming(false);
      setNewTime('');
      router.refresh();
    });
  }

  function submitReschedule(event) {
    event.preventDefault();
    if (!newTime.trim()) return;
    run('RESCHEDULED', newTime.trim());
  }

  const hasSecondary = can('RESCHEDULED') || can('DECLINED') || can('CANCELLED');

  return (
    <div className="u-card rounded-card bg-surface p-4 sm:p-6">
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
            {viewingRequest.customer_notified_at && (
              <span className="inline-flex items-center gap-1.5 text-success">
                <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('agent.visits.clientNotifiedBadge')}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {can('CONFIRMED') && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming((v) => !v)}
              aria-expanded={confirming}
              className="u-btn-primary u-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-blue text-sm font-bold text-white disabled:opacity-60"
            >
              <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.visits.confirm')}
            </button>
          )}
          {hasSecondary && (
            <div className="flex gap-2">
              {can('RESCHEDULED') && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setReschedule((v) => !v)}
                  aria-expanded={reschedule}
                  className={`${SECONDARY_BUTTON} text-ink-45 hover:bg-canvas-alt hover:text-ink`}
                >
                  <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  {t('agent.visits.reschedule')}
                </button>
              )}
              {can('DECLINED') && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run('DECLINED')}
                  className={`${SECONDARY_BUTTON} text-danger hover:bg-danger-tint`}
                >
                  <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  {t('agent.visits.decline')}
                </button>
              )}
              {can('CANCELLED') && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run('CANCELLED')}
                  className={`${SECONDARY_BUTTON} text-danger hover:bg-danger-tint`}
                >
                  <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  {t('agent.visits.cancelVisit')}
                </button>
              )}
            </div>
          )}
          {actions.length === 0 && <p className="text-xs text-ink-35">{t('agent.visits.closed')}</p>}
        </div>
      </div>

      {confirming && can('CONFIRMED') && (
        <div className="mt-4 border-t border-line pt-4">
          <VisitSlotForm
            id={viewingRequest.id}
            prefill={confirmPrefill(viewingRequest)}
            submitLabel={t('agent.agenda.confirm.submit')}
            pending={pending}
            onSubmit={(iso) => run('CONFIRMED', undefined, iso)}
          />
        </div>
      )}

      {reschedule && can('RESCHEDULED') && (
        <form onSubmit={submitReschedule} className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor={`reschedule-${viewingRequest.id}`} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
              {t('agent.visits.newSlotProposed')}
            </label>
            <input
              id={`reschedule-${viewingRequest.id}`}
              type="text"
              required
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              placeholder={t('agent.visits.slotPlaceholder')}
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
          >
            {pending ? 'Envoi…' : t('agent.visits.proposeSlot')}
          </button>
        </form>
      )}
    </div>
  );
}
