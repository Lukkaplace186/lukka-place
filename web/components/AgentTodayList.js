'use client';

import { Fragment, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlarmClock, AlertTriangle, CalendarClock, Check, ChevronRight, House, Mail, ClipboardList } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { updateViewingRequestAction } from '@/app/compte/agent/actions';
import { slotPhraseFr } from '@/lib/visitAgenda';
import { isNetworkError } from '@/lib/networkError';
import { useToast } from './Toast';
import VisitSlotForm from './VisitSlotForm';
import { useT } from '@/lib/i18n/client';
import { WhatsAppIcon } from './WhatsAppCTA';

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

// On a phone each row is a card in a sideways rail (2026-10-05), so its one
// action spans the card at a full 44px; from `lg` it is sized to its label
// again, in a list row.
const PRIMARY_BUTTON =
  'u-btn-primary u-press inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-3 text-sm font-bold text-white disabled:opacity-60 lg:h-9 lg:flex-none lg:text-[0.8125rem]';
const WHATSAPP_BUTTON =
  'u-press inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-green-ink px-3 text-sm font-bold text-white hover:brightness-110 lg:h-9 lg:flex-none lg:text-[0.8125rem]';
const SECONDARY_LINK =
  'u-micro u-hit relative inline-flex h-11 shrink-0 items-center rounded-lg px-3 font-semibold text-blue-deep ring-1 ring-inset ring-line hover:bg-canvas-alt lg:h-9 lg:px-1.5 lg:ring-0 lg:hover:bg-transparent lg:hover:underline';

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
 *
 * A row the agent has just answered leaves the list at once (`done`), before
 * the server replies; a failure puts it back with the toast. router.refresh()
 * then brings the server's own list, which no longer holds it.
 */
export default function AgentTodayList({ rows, seeAll }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(null); // `${key}:confirm` | `${key}:propose`
  const [pendingKey, setPendingKey] = useState(null);
  const [done, setDone] = useState(() => new Set());
  const [pending, startTransition] = useTransition();

  const mark = (key, on) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  function answer(row, status, { requestedTime, scheduledAt } = {}) {
    const formData = new FormData();
    formData.set('status', status);
    if (requestedTime !== undefined) formData.set('requested_time', requestedTime);
    if (scheduledAt !== undefined) formData.set('scheduled_at', scheduledAt);
    setPendingKey(row.key);
    mark(row.key, true);
    setOpen(null);

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
        mark(row.key, false);
        return;
      }
      setPendingKey(null);
      if (!result.ok) {
        mark(row.key, false);
        showToast({ type: 'error', message: result.error });
        return;
      }
      const done = status === 'CONFIRMED' ? t('agent.visits.confirmed') : t('agent.visits.rescheduled');
      const notice = result.tenantNotified ? t('agent.visits.clientNotified') : t('agent.visits.clientNotNotified');
      showToast({
        type: result.unchanged || result.tenantNotified ? 'success' : 'error',
        message: result.unchanged ? t('agent.visits.alreadyDone') : `${done} ${notice}`,
      });
      router.refresh();
    });
  }

  const visibleRows = rows.filter((row) => !done.has(row.key));

  return (
    <>
      {/* Phone: a sideways rail of cards, one action each, the next card
          peeking in. lg: the plain divided list it always was. */}
      <ul className="u-stagger no-scrollbar -mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto px-3 pb-1 sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:mx-0 lg:flex-col lg:gap-0 lg:divide-y lg:divide-line lg:overflow-visible lg:px-0 lg:pb-0">
        {visibleRows.map((row) => {
          const Icon = KIND_ICON[row.kind] || ClipboardList;
          const busy = pending && pendingKey === row.key;
          const confirmOpen = open === `${row.key}:confirm`;
          const proposeOpen = open === `${row.key}:propose`;
          const toggle = (which) => setOpen((v) => (v === `${row.key}:${which}` ? null : `${row.key}:${which}`));

          let primary;
          if (row.primary.type === 'confirm-visit' && row.primary.prefill) {
            primary = (
              <button type="button" disabled={busy} className={PRIMARY_BUTTON} onClick={() => answer(row, 'CONFIRMED', { scheduledAt: row.primary.prefill })}>
                <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
                <span className="truncate">{busy ? t('agent.agenda.sending') : t('agent.today.action.confirmAt', { slot: row.prefillLabel })}</span>
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
                {row.stale ? t('agent.today.action.relaunch') : t(PRIMARY_LABEL_KEY[row.primary.type])}
              </button>
            );
          } else if (row.kind === 'lead' && row.waHref) {
            primary = (
              <a href={row.waHref} target="_blank" rel="noopener noreferrer" className={WHATSAPP_BUTTON}>
                <WhatsAppIcon className="h-4 w-4 shrink-0" />
                {t('agent.leads.replyOnWhatsApp')}
              </a>
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
            <li
              key={row.key}
              className="u-card flex w-[86%] max-w-[22rem] shrink-0 snap-start flex-col rounded-card bg-surface p-3.5 lg:w-auto lg:max-w-none lg:rounded-none lg:bg-transparent lg:p-0 lg:py-3 lg:shadow-none lg:first:pt-0 lg:last:pb-0"
            >
              <div className="flex flex-1 items-start gap-3">
                <span
                  className={`mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full lg:inline-flex ${
                    row.overdue ? 'bg-danger-tint text-danger' : row.stale ? 'bg-canvas-deep text-ink-45' : 'bg-blue-tint text-blue-deep'
                  }`}
                  aria-hidden="true"
                >
                  {row.overdue ? <AlarmClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
                </span>
                <div className="flex min-h-full min-w-0 flex-1 flex-col gap-2.5 self-stretch lg:flex-row lg:items-center lg:self-auto">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between gap-2 lg:hidden">
                      <span className="min-w-0 truncate text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-ink-45">{row.kindLabel}</span>
                      {row.badge && <TodoBadge row={row} />}
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[0.9375rem] font-bold text-ink lg:text-[0.8125rem] lg:font-semibold">{row.title}</span>
                      {row.badge && (
                        <span className="hidden lg:inline">
                          <TodoBadge row={row} />
                        </span>
                      )}
                    </div>
                    {row.subtitle && <div className="u-micro truncate text-ink-70">{row.subtitle}</div>}
                    {row.meta && <div className="u-micro truncate text-ink-45">{row.meta}</div>}
                    {row.gapLabels?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {row.gapLabels.map((label) => (
                          <span key={label} className="inline-flex min-h-7 items-center gap-1 rounded-md bg-warning-tint px-2 text-xs font-semibold text-warning-ink">
                            <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-auto flex min-w-0 items-center gap-2 lg:mt-0 lg:flex-none lg:justify-end lg:gap-1">
                    {primary}
                    {row.primary.type === 'confirm-visit' && row.primary.prefill && (
                      <button type="button" onClick={() => toggle('confirm')} aria-expanded={confirmOpen} className={SECONDARY_LINK}>
                        {t('agent.today.action.otherTime')}
                      </button>
                    )}
                    {row.kind === 'lead' && row.waHref && (
                      <Link href={row.primary.href} className={SECONDARY_LINK}>
                        {t('agent.today.action.open')}
                      </Link>
                    )}
                    {row.secondary?.type === 'close-visit' && (
                      <Link href={row.secondary.href} className={SECONDARY_LINK}>
                        {t('agent.today.action.closeVisit')}
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              {(confirmOpen || proposeOpen) && (
                <div className="mt-3 rounded-lg bg-canvas-alt p-3 lg:ml-11">
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
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 lg:mt-3.5 lg:border-t lg:border-line lg:pt-3">
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

function TodoBadge({ row }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-extrabold uppercase tracking-[0.08em] ${
        row.overdue
          ? 'u-attention bg-danger-tint text-danger'
          : row.stale
            ? 'bg-canvas-deep text-ink-70'
            : 'bg-warning-tint text-warning-ink'
      }`}
    >
      {row.badge}
    </span>
  );
}
