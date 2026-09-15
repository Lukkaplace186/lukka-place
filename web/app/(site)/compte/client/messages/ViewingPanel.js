'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, MessageCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useToast } from '@/components/Toast';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { isNetworkError } from '@/lib/networkError';
import { VIEWING_CHECKIN_RESPONSES, VIEWING_FALLOFF_REASON_CODES } from '@/lib/viewingTimeline';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

// Keys, not text — see components/navItems.js.
const STEP_LABEL_KEYS = {
  requested: 'account.visits.steps.requested',
  awaitingAgent: 'account.visits.steps.awaitingAgent',
  awaitingAgentAlternatives: 'account.visits.steps.awaitingAgentAlternatives',
  newSlot: 'account.visits.steps.newSlot',
  confirmed: 'account.visits.steps.confirmed',
  declined: 'account.visits.steps.declined',
  cancelledByYou: 'account.visits.steps.cancelledByYou',
  cancelledByAgent: 'account.visits.steps.cancelledByAgent',
  cancelled: 'account.visits.steps.cancelled',
  visit: 'account.visits.steps.visit',
  agentAbsent: 'account.visits.steps.agentAbsent',
  feedback: 'account.visits.steps.feedback',
  feedbackGiven: 'account.visits.steps.feedbackGiven',
};

const CHECKIN_LABEL_KEYS = {
  GOOD: 'account.visits.checkin.GOOD',
  BAD: 'account.visits.checkin.BAD',
  AGENT_ABSENT: 'account.visits.checkin.AGENT_ABSENT',
};

const REASON_LABEL_KEYS = {
  PRICE_TOO_HIGH: 'account.visits.reasons.PRICE_TOO_HIGH',
  LOCATION_DESELECTED: 'account.visits.reasons.LOCATION_DESELECTED',
  TERMS_UNACCEPTABLE: 'account.visits.reasons.TERMS_UNACCEPTABLE',
  OTHER: 'account.visits.reasons.OTHER',
};

const DOT_CLASS = {
  done: 'bg-blue text-white',
  current: 'bg-blue-tint text-blue-deep shadow-[inset_0_0_0_1.5px_var(--blue)]',
  upcoming: 'bg-canvas-deep text-ink-35',
  stopped: 'bg-danger-tint text-danger',
};

// 44px tall (min-h-11): these are thumb targets on a 360px phone, and a
// mis-tap on "Agent absent" beside "👍" sends the agent's desk a false report.
const CHOICE_CLASS =
  'u-press inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-[0.875rem] font-semibold shadow-[inset_0_0_0_1px_var(--line)] transition-colors disabled:opacity-60';

/** The one line under a step, from real fields only — nothing when there is nothing to say. */
function stepDetail(key, viewing, translate) {
  const slot = viewing.requestedTime;
  const scheduled = viewing.scheduledAtLabel;
  switch (key) {
    case 'requested':
      return [
        translate('account.visits.detail.requestedOn', { date: viewing.createdAtLabel }),
        slot ? translate('account.visits.detail.slotRequested', { time: slot }) : null,
      ].filter(Boolean).join(' · ');
    case 'awaitingAgent':
      return translate('account.visits.detail.awaitingAgent');
    case 'awaitingAgentAlternatives':
      return translate('account.visits.detail.alternativesSent');
    case 'newSlot':
      return slot ? translate('account.visits.detail.proposedSlot', { time: slot }) : null;
    case 'confirmed':
      if (scheduled) return translate('account.visits.detail.scheduledFor', { date: scheduled });
      return slot ? translate('account.visits.detail.slot', { time: slot }) : null;
    case 'visit':
      return scheduled
        ? translate('account.visits.detail.scheduledFor', { date: scheduled })
        : translate('account.visits.detail.noInstant');
    case 'declined':
      return translate('account.visits.detail.declined');
    case 'agentAbsent':
      return translate('account.visits.detail.agentAbsent');
    default:
      return null;
  }
}

/**
 * A customer's visit, as it actually stands, with the answers they can give.
 *
 * This replaces two WhatsApp links ("Convenir d'un créneau" / "Annuler la
 * visite") that opened a chat with the central number and changed nothing:
 * the request stayed PENDING, the agent was never told, and the account went
 * on showing a visit the customer had called off. Every button here is a real
 * write through the engine, which tells the agent and the desk.
 *
 * `viewing.timeline` is computed on the server (lib/viewingTimeline.js), so
 * which buttons exist is decided once, with the server's clock.
 *
 * INSTANT FEEDBACK. On a 3G link the engine round trip plus the refresh is
 * seconds, and a button that merely greys out for that long reads as broken,
 * so the tap is acknowledged at once: the chosen answer is marked, and every
 * other answer is locked so a second tap cannot send a contradictory one.
 * `sent` remembers which `viewing` object it was made against — the refresh
 * delivers a new one, and at that moment the server's own timeline takes over
 * with nothing to reset by hand. (Not `useOptimistic`: that reverts when the
 * action's transition ends, which is BEFORE router.refresh() has delivered
 * the new timeline, so the answer would visibly flicker off and back on.)
 * A failure clears it and says why; a dropped connection says so and offers
 * to retry, which is safe because the engine ignores a repeated answer.
 */
export default function ViewingPanel({ viewing, actions, whatsappNumber }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sent, setSent] = useState(null);
  const { timeline } = viewing;
  const shown = sent && sent.viewing === viewing ? sent : null;
  const locked = pending || Boolean(shown);

  function run(kind, action, ...args) {
    if (!action) return;
    setSent({ kind, value: args[0] ?? null, viewing });
    setConfirmOpen(false);
    startTransition(async () => {
      let result;
      try {
        result = await action(viewing.id, ...args);
      } catch (err) {
        setSent(null);
        if (isNetworkError(err)) {
          showToast({
            type: 'error',
            message: t('common.network.actionOffline'),
            action: { label: t('common.network.retry'), onClick: () => run(kind, action, ...args) },
          });
          return;
        }
        result = { ok: false, error: t('account.visits.errors.failed') };
      }
      if (!result?.ok) {
        setSent(null);
        showToast({ type: 'error', message: result?.error || t('account.visits.errors.failed') });
        return;
      }
      if (result.message) showToast({ message: result.message });
      router.refresh();
    });
  }

  function choiceClass(kind, value) {
    const chosen = shown?.kind === kind && shown.value === value;
    return cn(
      CHOICE_CLASS,
      chosen ? 'bg-blue-tint text-blue-deep shadow-[inset_0_0_0_1.5px_var(--blue)]' : 'text-ink-70 hover:bg-canvas-alt',
    );
  }

  function sendingMark(kind, value = null) {
    if (shown?.kind !== kind || shown.value !== value) return null;
    return <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />;
  }

  // Questions still go to a person. French, like every message this product
  // pre-types for its own team (lib/whatsapp.js).
  const questionHref = whatsappNumber
    ? buildWhatsAppLink(whatsappNumber, `Bonjour, j'ai une question sur ma demande de visite n° ${viewing.id}.`)
    : null;

  return (
    <div className="rounded-card bg-surface p-5 shadow-[var(--hairline)]" aria-busy={pending || undefined}>
      <p className="u-eyebrow">{t('account.visits.timelineTitle')}</p>

      <ol className="mt-4 flex flex-col">
        {timeline.steps.map((step, index) => {
          const detail = step.state === 'upcoming' ? null : stepDetail(step.key, viewing, t);
          const last = index === timeline.steps.length - 1;
          return (
            <li key={step.key} className={cn('relative flex gap-3.5', last ? '' : 'pb-5')}>
              {!last ? (
                <span
                  aria-hidden="true"
                  className={cn('absolute bottom-0 left-[0.8125rem] top-7 w-px', step.state === 'done' ? 'bg-blue' : 'bg-line')}
                />
              ) : null}
              <span
                className={cn(
                  'relative grid h-[1.625rem] w-[1.625rem] shrink-0 place-items-center rounded-full text-[0.6875rem] font-bold',
                  DOT_CLASS[step.state],
                )}
              >
                {step.state === 'done' ? (
                  <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                ) : step.state === 'stopped' ? (
                  <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cn('text-[0.875rem] font-bold leading-snug', step.state === 'upcoming' ? 'text-ink-35' : 'text-ink')}>
                  {t(STEP_LABEL_KEYS[step.key])}
                </p>
                {detail ? <p className="mt-1 text-[0.8125rem] leading-[1.5] text-ink-45">{detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {shown ? (
        <p role="status" className="mt-4 text-[0.8125rem] font-semibold text-blue-deep">
          {t('account.visits.sending')}
        </p>
      ) : null}

      {timeline.canCheckin && actions?.checkin ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="u-title-sub text-ink">{t('account.visits.howWasItTitle')}</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {VIEWING_CHECKIN_RESPONSES.map((response) => (
              <button
                key={response}
                type="button"
                disabled={locked}
                aria-pressed={shown?.kind === 'checkin' && shown.value === response}
                onClick={() => run('checkin', actions.checkin, response)}
                className={choiceClass('checkin', response)}
              >
                {sendingMark('checkin', response)}
                {t(CHECKIN_LABEL_KEYS[response])}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {timeline.canGiveReason && actions?.falloff ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="u-title-sub text-ink">{t('account.visits.whyTitle')}</p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            {VIEWING_FALLOFF_REASON_CODES.map((code) => (
              <button
                key={code}
                type="button"
                disabled={locked}
                aria-pressed={shown?.kind === 'falloff' && shown.value === code}
                onClick={() => run('falloff', actions.falloff, code)}
                className={choiceClass('falloff', code)}
              >
                {sendingMark('falloff', code)}
                {t(REASON_LABEL_KEYS[code])}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {(timeline.canAcceptSlot && actions?.acceptSlot) || (timeline.canCancel && actions?.cancel) || questionHref ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {timeline.canAcceptSlot && actions?.acceptSlot ? (
            <button
              type="button"
              disabled={locked}
              onClick={() => run('acceptSlot', actions.acceptSlot)}
              className="u-btn-primary u-press inline-flex min-h-11 items-center gap-2 rounded-full bg-blue px-5 text-[0.875rem] font-semibold text-white disabled:opacity-60"
            >
              <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.visits.acceptSlot')}
            </button>
          ) : null}
          {timeline.canCancel && actions?.cancel ? (
            <button
              type="button"
              disabled={locked}
              onClick={() => setConfirmOpen(true)}
              className="u-press inline-flex min-h-11 items-center rounded-full px-4 text-[0.875rem] font-semibold text-ink-45 transition-colors hover:bg-danger-tint hover:text-danger disabled:opacity-60"
            >
              {t('account.visits.cancel')}
            </button>
          ) : null}
          {questionHref ? (
            <a
              href={questionHref}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex min-h-11 items-center gap-1.5 text-[0.875rem] font-semibold text-blue-deep hover:underline"
            >
              <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('account.visits.askQuestion')}
            </a>
          ) : null}
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('account.visits.cancelConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('account.visits.cancelConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
              >
                {t('account.visits.keep')}
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={locked}
              onClick={() => run('cancel', actions?.cancel)}
              className="u-press h-11 rounded-lg bg-danger-tint px-5 text-sm font-bold text-danger disabled:opacity-60"
            >
              {t('account.visits.cancel')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
