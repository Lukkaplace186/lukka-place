'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Check, X, CalendarCheck, CalendarClock, MoreHorizontal, Home, MessageCircle, Target } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { updateViewingRequestAction } from '@/app/compte/agent/actions';
import { agentActionsFor } from '@/lib/viewingActions';
import { confirmPrefill, formatVisitDay, formatVisitTime } from '@/lib/visitAgenda';
import { leadTelHref, leadWhatsAppLink } from '@/lib/leadContact';
import { WhatsAppIcon } from './WhatsAppCTA';
import VisitSlotForm from './VisitSlotForm';
import { useToast } from './Toast';
import AgentQuickReplies from './AgentQuickReplies';
import AgentAlternativesDialog from './AgentAlternativesDialog';
import { isNetworkError } from '@/lib/networkError';
import { VIEWING_REQUEST_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { useLocale, useT } from '@/lib/i18n/client';

const STATUS_TAG = {
  PENDING: 'bg-warning-tint text-warning-ink',
  CONFIRMED: 'bg-success-tint text-success',
  RESCHEDULED: 'bg-blue-tint text-blue-deep',
  CANCELLED: 'bg-canvas-deep text-ink-45',
  DECLINED: 'bg-danger-tint text-danger',
  COMPLETED: 'bg-success-tint text-success',
};

// The inbox's own words for the states that wait on the agent (2026-10-06):
// "À confirmer" says what to do, where "En attente" only said what it is.
const INBOX_BADGE_KEYS = {
  PENDING: 'agent.inbox.badge.toConfirm',
  RESCHEDULED: 'agent.inbox.badge.slotProposed',
  CONFIRMED: 'agent.inbox.badge.confirmed',
};

const upperFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const PRIMARY = 'u-press inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] font-bold disabled:opacity-60';
const ICON_BUTTON = 'u-press grid h-12 w-12 shrink-0 place-items-center rounded-xl text-ink-70 ring-1 ring-inset ring-ink-25 transition-colors hover:bg-canvas-alt hover:text-ink';
const SECONDARY = 'u-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-semibold transition-colors disabled:opacity-60';

/**
 * One viewing request in the agent's single Demandes inbox (2026-10-06
 * redesign, product direction: one primary action per card, everything else
 * behind "···"). Name, state and age on top; the slot in bold and the listing
 * under it; then ONE button that depends on the state —
 *
 *   to confirm (PENDING / RESCHEDULED)  "Confirmer la visite" (royal), which
 *                                       opens the date + time step
 *   confirmed                           "Contacter sur WhatsApp" (green)
 *   settled                             "Répondre sur WhatsApp" (green)
 *
 * — beside a call icon and "···", which holds what the state still allows
 * (lib/viewingActions.js): Déplacer, Refuser / Annuler la visite, WhatsApp
 * when it is not already the primary, quick replies, alternatives.
 *
 * Every answer goes through updateViewingRequestAction, which reaches the
 * customer on WhatsApp; the toast says whether that message actually left.
 * The answer shows on the card the moment it is tapped (keyed to the
 * `viewingRequest` object, ViewingPanel's pattern) and a failure clears it.
 */
export default function AgentVisitRequestCard({ viewingRequest, statusLabel, relativeTime, target, highlighted = false }) {
  const t = useT();
  const locale = useLocale();
  const [reschedule, setReschedule] = useState(false);
  // Confirm opens a date + time step: a dashboard confirmation must carry the
  // agreed instant (lib/visitAgenda.js, "`scheduled_at`" in root CLAUDE.md).
  const [confirming, setConfirming] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const [answered, setAnswered] = useState(null);
  const status = answered?.for === viewingRequest ? answered.status : viewingRequest.status;
  const statusText = INBOX_BADGE_KEYS[status]
    ? t(INBOX_BADGE_KEYS[status])
    : status === viewingRequest.status
      ? statusLabel
      : VIEWING_REQUEST_STATUS_LABEL_KEYS[status]
        ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[status])
        : status;

  const name = viewingRequest.lead_name || viewingRequest.lead_wa_id;
  const actions = agentActionsFor(status);
  const can = (next) => actions.includes(next);

  const doneMessage = {
    CONFIRMED: t('agent.visits.confirmed'),
    RESCHEDULED: t('agent.visits.rescheduled'),
    DECLINED: t('agent.visits.declined'),
    CANCELLED: t('agent.visits.cancelled'),
  };

  function run(next, requestedTime, scheduledAt) {
    const formData = new FormData();
    formData.set('status', next);
    if (requestedTime !== undefined) formData.set('requested_time', requestedTime);
    if (scheduledAt !== undefined) formData.set('scheduled_at', scheduledAt);

    setAnswered({ for: viewingRequest, status: next });
    setReschedule(false);
    setConfirming(false);
    setMoreOpen(false);

    startTransition(async () => {
      let result;
      try {
        result = await updateViewingRequestAction(viewingRequest.id, formData);
      } catch (err) {
        // A rejected Server Action (expired session, dropped connection) is not
        // an {ok:false}; without this the buttons would simply go dead.
        console.error('[AgentVisitRequestCard] updateViewingRequestAction failed', err);
        setAnswered(null);
        // Safe to retry: the engine ignores a repeated status.
        if (isNetworkError(err)) {
          showToast({
            type: 'error',
            message: t('common.network.actionOffline'),
            action: { label: t('common.network.retry'), onClick: () => run(next, requestedTime, scheduledAt) },
          });
          return;
        }
        showToast({ type: 'error', message: t('errors.submissionFailed') });
        return;
      }
      if (!result.ok) {
        setAnswered(null);
        showToast({ type: 'error', message: result.error });
        return;
      }
      if (result.unchanged) {
        showToast({ type: 'success', message: t('agent.visits.alreadyDone') });
      } else {
        const notice = result.tenantNotified ? t('agent.visits.clientNotified') : t('agent.visits.clientNotNotified');
        showToast({ type: result.tenantNotified ? 'success' : 'error', message: `${doneMessage[next]} ${notice}` });
      }
      setNewTime('');
      router.refresh();
    });
  }

  function submitReschedule(event) {
    event.preventDefault();
    if (!newTime.trim()) return;
    run('RESCHEDULED', newTime.trim());
  }

  // The agreed instant once there is one, else the slot the customer picked
  // (`requested_slot_at`, engine-parsed), else their own words. Kinshasa time.
  const agreed = status === 'CONFIRMED' && viewingRequest.scheduled_at ? viewingRequest.scheduled_at : null;
  const slotAt = agreed || (status === 'PENDING' ? viewingRequest.requested_slot_at : null) || null;
  const slotText = slotAt
    ? `${upperFirst(formatVisitDay(slotAt, locale, { long: false }))} · ${formatVisitTime(slotAt, locale)}`
    : viewingRequest.requested_time || t('agent.visits.noSlot');
  const slotCaption = agreed ? t('agent.visits.slotAgreed') : slotAt ? t('agent.visits.slotPicked') : t('agent.visits.slotInWords');
  const waHref = leadWhatsAppLink({
    wa_id: viewingRequest.lead_wa_id,
    name: viewingRequest.lead_name,
    property_id: viewingRequest.property_id || viewingRequest.lead_property_id,
  });
  const telHref = leadTelHref(viewingRequest.lead_wa_id);
  const toConfirm = can('CONFIRMED');
  const SlotIcon = agreed ? CalendarCheck : CalendarClock;

  const whatsappLink = (className, label) => (
    <a href={waHref} target="_blank" rel="noopener noreferrer" className={className}>
      <WhatsAppIcon className="h-5 w-5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );

  return (
    <article className={`u-card rounded-card bg-surface p-4 sm:p-5 ${highlighted ? 'ring-2 ring-blue' : ''}`}>
      {highlighted && (
        <p className="u-micro-strong mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1 text-blue-deep">
          <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('agent.leads.fromWhatsAppAlert')}
        </p>
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink">{name}</p>
          <p className="text-xs text-ink-45">
            {t('agent.inbox.kind.visit')} · {relativeTime}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] ${STATUS_TAG[status] || STATUS_TAG.PENDING}`}>
          {statusText}
        </span>
      </header>

      <div className="mt-3 flex flex-col gap-1.5">
        <p className={`flex items-start gap-2 text-[0.9375rem] font-extrabold leading-snug ${agreed ? 'text-success' : 'text-ink'}`}>
          <SlotIcon strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block">{slotText}</span>
            <span className="block text-xs font-semibold text-ink-45">{slotCaption}</span>
          </span>
        </p>
        {target && (
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink-70">
            <Home strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" aria-hidden="true" />
            <span className="truncate">{target}</span>
          </p>
        )}
        {viewingRequest.customer_notified_at && (
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            {t('agent.visits.clientNotifiedBadge')}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {toConfirm ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming((v) => !v)}
            aria-expanded={confirming}
            className={`${PRIMARY} u-btn-primary bg-blue text-white`}
          >
            <Check strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0" />
            <span className="truncate">{t('agent.inbox.confirmVisit')}</span>
          </button>
        ) : waHref ? (
          whatsappLink(`${PRIMARY} bg-green-ink text-white hover:brightness-110`, status === 'CONFIRMED' ? t('agent.inbox.contactWhatsApp') : t('agent.leads.replyOnWhatsApp'))
        ) : (
          <div className="min-w-0 flex-1">
            <AgentAlternativesDialog kind="visit" id={viewingRequest.id} emphasis />
          </div>
        )}
        {telHref && (
          <a href={telHref} aria-label={t('agent.leads.call')} title={t('agent.leads.call')} className={ICON_BUTTON}>
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </a>
        )}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          aria-label={t('agent.leads.moreOptions')}
          title={t('agent.leads.moreOptions')}
          className={`${ICON_BUTTON} ${moreOpen ? 'bg-canvas-alt text-ink' : ''}`}
        >
          <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        </button>
      </div>

      {confirming && toConfirm && (
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

      {/* Hidden rather than unmounted, so a half-typed slot survives closing it. */}
      <div hidden={!moreOpen} className="mt-3 border-t border-line pt-3">
        <div className="flex flex-col gap-1.5">
          {toConfirm && waHref && whatsappLink(`${SECONDARY} text-green-ink ring-1 ring-inset ring-ink-25 hover:bg-canvas-alt`, t('agent.leads.replyOnWhatsApp'))}
          {can('RESCHEDULED') && (
            <button type="button" disabled={pending} onClick={() => setReschedule((v) => !v)} aria-expanded={reschedule} className={`${SECONDARY} text-ink hover:bg-canvas-alt`}>
              <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.inbox.move')}
            </button>
          )}
          {reschedule && can('RESCHEDULED') && (
            <form onSubmit={submitReschedule} className="flex flex-col gap-2 rounded-lg bg-canvas-alt p-3 sm:flex-row sm:items-end">
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
                  className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-35 sm:text-sm"
                />
              </div>
              <button type="submit" disabled={pending} className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60">
                {pending ? t('common.actions.sending') : t('agent.visits.proposeSlot')}
              </button>
            </form>
          )}
          {can('DECLINED') && (
            <button type="button" disabled={pending} onClick={() => run('DECLINED')} className={`${SECONDARY} text-danger hover:bg-danger-tint`}>
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.inbox.decline')}
            </button>
          )}
          {can('CANCELLED') && (
            <button type="button" disabled={pending} onClick={() => run('CANCELLED')} className={`${SECONDARY} text-danger hover:bg-danger-tint`}>
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.visits.cancelVisit')}
            </button>
          )}
          <AgentQuickReplies
            waId={viewingRequest.lead_wa_id}
            clientName={viewingRequest.lead_name}
            propertyId={viewingRequest.property_id || viewingRequest.lead_property_id}
          />
          {/* After a refusal the customer still needs somewhere to live. */}
          {waHref && <AgentAlternativesDialog kind="visit" id={viewingRequest.id} emphasis={status === 'DECLINED' || status === 'CANCELLED'} />}
          {actions.length === 0 && <p className="text-center text-xs text-ink-35">{t('agent.visits.closed')}</p>}
        </div>
      </div>
    </article>
  );
}
