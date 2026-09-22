'use client';

import { Fragment, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlarmClock, CalendarClock, Check, ChevronRight, House, Mail, ClipboardList } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { updateViewingRequestAction } from '@/app/compte/agent/actions';
import { slotPhraseFr } from '@/lib/visitAgenda';
import { isNetworkError } from '@/lib/networkError';
import { useToast } from './Toast';
import VisitSlotForm from './VisitSlotForm';
import { useT } from '@/lib/i18n/client';

const KIND_ICON = {
  visit: CalendarClock,
  lead: Mail,
  'listing-confirm': House,
  'listing-incomplete': ClipboardList,
};

const PRIMARY_LABEL_KEY = {
  'confirm-visit': 'agent.today.action.confirmVisit',
  'propose-slot': 'agent.today.action.proposeSlot',
  'open-lead': 'agent.today.action.openLead',
  'confirm-availability': 'agent.today.action.confirmAvailability',
  complete: 'agent.today.action.complete',
};

const PRIMARY_BUTTON =
  'u-btn-primary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60 sm:w-auto';

/**
 * "À faire aujourd'hui" rows (ranking: lib/agentTodo.js). Each row has ONE
 * primary action; the visit actions answer through the existing
 * updateViewingRequestAction — the same write path, customer message and
 * transition table as the Visites tab, nothing new.
 *
 * A visit whose slot is known and still ahead confirms in one tap, with the
 * slot printed ON the button so the agent sees exactly what the customer will
 * be told; "Autre heure" opens the date + time form instead. With no known
 * slot, the primary action opens that form directly — a confirmation must name
 * an instant. An overdue visit proposes a new slot rather than confirming a
 * time that has gone by (the engine refuses that).
 *
 * `rows` arrive with their display text already resolved on the server
 * (title, subtitle, meta), so nothing here reads the clock during render.
 */
export default function AgentTodayList({ rows, seeAll }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(null); // `${key}:confirm` | `${key}:propose`
  const [pendingKey, setPendingKey] = useState(null);
  const [pending, startTransition] = useTransition();

  function answer(row, status, { requestedTime, scheduledAt } = {}) {
    const formData = new FormData();
    formData.set('status', status);
    if (requestedTime !== undefined) formData.set('requested_time', requestedTime);
    if (scheduledAt !== undefined) formData.set('scheduled_at', scheduledAt);
    setPendingKey(row.key);

    startTransition(async () => {
      let result;
      try {
        result = await updateViewingRequestAction(row.id, formData);
      } catch (err) {
        console.error('[AgentTodayList] updateViewingRequestAction failed', err);
        showToast(
          isNetworkError(err)
            ? {
                type: 'error',
                message: t('common.network.actionOffline'),
                action: { label: t('common.network.retry'), onClick: () => answer(row, status, { requestedTime, scheduledAt }) },
              }
            : { type: 'error', message: t('errors.submissionFailed') },
        );
        setPendingKey(null);
        return;
      }
      setPendingKey(null);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      const done = status === 'CONFIRMED' ? t('agent.visits.confirmed') : t('agent.visits.rescheduled');
      const notice = result.tenantNotified ? t('agent.visits.clientNotified') : t('agent.visits.clientNotNotified');
      showToast({
        type: result.unchanged || result.tenantNotified ? 'success' : 'error',
        message: result.unchanged ? t('agent.visits.alreadyDone') : `${done} ${notice}`,
      });
      setOpen(null);
      router.refresh();
    });
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((row) => {
          const Icon = KIND_ICON[row.kind] || ClipboardList;
          const busy = pending && pendingKey === row.key;
          const confirmOpen = open === `${row.key}:confirm`;
          const proposeOpen = open === `${row.key}:propose`;
          const toggle = (which) => setOpen((v) => (v === `${row.key}:${which}` ? null : `${row.key}:${which}`));

          let primary;
          if (row.primary.type === 'confirm-visit' && row.primary.prefill) {
            primary = (
              <button type="button" disabled={busy} className={PRIMARY_BUTTON} onClick={() => answer(row, 'CONFIRMED', { scheduledAt: row.primary.prefill })}>
                <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {busy ? t('agent.agenda.sending') : t('agent.today.action.confirmAt', { slot: row.prefillLabel })}
              </button>
            );
          } else if (row.primary.type === 'confirm-visit' || row.primary.type === 'propose-slot') {
            const which = row.primary.type === 'confirm-visit' ? 'confirm' : 'propose';
            primary = (
              <button
                type="button"
                disabled={busy}
                aria-expanded={open === `${row.key}:${which}`}
                className={PRIMARY_BUTTON}
                onClick={() => toggle(which)}
              >
                {which === 'confirm' ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
                {t(PRIMARY_LABEL_KEY[row.primary.type])}
              </button>
            );
          } else {
            primary = (
              <Link href={row.primary.href} className={PRIMARY_BUTTON}>
                {t(PRIMARY_LABEL_KEY[row.primary.type])}
                <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </Link>
            );
          }

          return (
            <li key={row.key} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      row.overdue ? 'bg-danger-tint text-danger' : 'bg-blue-tint text-blue-deep'
                    }`}
                    aria-hidden="true"
                  >
                    {row.overdue ? <AlarmClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="u-micro-strong truncate text-ink">{row.title}</span>
                      {row.badge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] ${
                            row.overdue ? 'bg-danger-tint text-danger' : 'bg-warning-tint text-warning'
                          }`}
                        >
                          {row.badge}
                        </span>
                      )}
                    </div>
                    {row.subtitle && <div className="u-micro truncate text-ink-70">{row.subtitle}</div>}
                    {row.meta && <div className="u-micro text-ink-45">{row.meta}</div>}
                  </div>
                </div>
                <div className="flex flex-col items-stretch gap-1 sm:items-end">
                  {primary}
                  {row.primary.type === 'confirm-visit' && row.primary.prefill && (
                    <button
                      type="button"
                      onClick={() => toggle('confirm')}
                      aria-expanded={confirmOpen}
                      className="u-micro inline-flex min-h-10 items-center justify-center px-2 font-semibold text-blue-deep hover:underline"
                    >
                      {t('agent.today.action.otherTime')}
                    </button>
                  )}
                </div>
              </div>

              {(confirmOpen || proposeOpen) && (
                <div className="mt-3 rounded-lg bg-canvas-alt p-3">
                  <VisitSlotForm
                    id={`todo-${row.id}`}
                    prefill={confirmOpen ? row.primary.prefill : null}
                    pending={busy}
                    submitLabel={confirmOpen ? t('agent.agenda.confirm.submit') : t('agent.visits.proposeSlot')}
                    hint={proposeOpen ? t('agent.today.proposeHint') : undefined}
                    onSubmit={(iso) =>
                      confirmOpen
                        ? answer(row, 'CONFIRMED', { scheduledAt: iso })
                        : answer(row, 'RESCHEDULED', { requestedTime: slotPhraseFr(iso) })
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {seeAll.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3">
          {seeAll.map((link) => (
            <Fragment key={link.kind}>
              <Link href={link.href} className="u-micro inline-flex min-h-10 items-center font-semibold text-blue-deep hover:underline">
                {link.label}
              </Link>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
