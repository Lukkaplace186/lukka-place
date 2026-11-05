'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CalendarCheck, Clock3, MessageCircle, Search } from 'lucide-react';
import { ChatAvatar } from './ChatParts';
import ChatSafetyNote from './ChatSafetyNote';
import { chatRequest } from '@/lib/chatClient';
import { chatInboxTime, chatWaitLabel } from '@/lib/chatTime';
import { CHAT_POLL } from '@/lib/chatRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

const FILTERS = ['all', 'unread', 'archived'];

/**
 * The inbox: the customer's at /messages, the agent's at
 * /compte/agent/messages (`side="agent"`). Server-rendered first page, then a
 * quiet refresh every 30 s while the tab is visible and on return to it
 * (CHAT_POLL.inboxMs) — no live connection exists on this stack.
 *
 * `variant="column"` is the agent's left column beside an open conversation:
 * no card frame, its own scroll, the open thread (`activeId`) highlighted.
 * On the agent side a conversation whose last message is the customer's
 * carries "Sans réponse · 12 min" — the wait the 15-minute rule is about.
 */
export default function ChatInbox({
  side = 'customer',
  basePath = '/messages',
  initialThreads,
  initialCursor,
  initialFilter = 'all',
  serverNow,
  variant = 'page',
  activeId = null,
}) {
  const t = useT();
  const locale = useLocale();
  const [filter, setFilter] = useState(initialFilter);
  const [threads, setThreads] = useState(initialThreads);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(serverNow);
  const filterRef = useRef(filter);

  const refresh = useCallback(async (view) => {
    const result = await chatRequest('/threads', { side, query: { filter: view } }).catch(() => null);
    if (!result?.ok || filterRef.current !== view) return;
    setThreads(result.data.threads);
    setCursor(result.data.nextCursor);
    setNow(new Date().toISOString());
  }, [side]);

  useEffect(() => {
    let timer = null;
    const tick = () => {
      if (document.visibilityState === 'visible') refresh(filterRef.current);
    };
    timer = window.setInterval(tick, CHAT_POLL.inboxMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  async function pick(view) {
    if (view === filter) return;
    filterRef.current = view;
    setFilter(view);
    setLoading(true);
    const url = new URL(window.location.href);
    if (view === 'all') url.searchParams.delete('filter');
    else url.searchParams.set('filter', view);
    window.history.replaceState(null, '', url);
    await refresh(view);
    setLoading(false);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    const result = await chatRequest('/threads', { side, query: { filter, cursor } }).catch(() => null);
    if (result?.ok) {
      setThreads((current) => [...current, ...result.data.threads.filter((th) => !current.some((c) => c.id === th.id))]);
      setCursor(result.data.nextCursor);
    }
    setLoading(false);
  }

  const unreadTotal = threads.filter((th) => th.unread > 0).length;
  const column = variant === 'column';

  return (
    <div className={cn('flex flex-col', column ? 'h-full min-h-0 gap-3' : 'gap-5')}>
      <div role="group" aria-label={t('chat.inbox.filtersLabel')} className={cn('flex flex-wrap gap-2', column && 'px-4')}>
        {FILTERS.map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={filter === view}
            onClick={() => pick(view)}
            className={cn(
              'u-press u-focus-ring inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.875rem] font-semibold transition-colors',
              filter === view ? 'bg-blue-tint text-blue-deep' : 'border border-line bg-surface text-ink-70 hover:bg-blue-tint',
            )}
          >
            {t(`chat.inbox.filters.${view}`)}
            {view === 'unread' && filter === 'all' && unreadTotal > 0 ? (
              <span className="u-tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue px-1.5 text-[0.75rem] font-bold text-white">
                {unreadTotal}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        aria-busy={loading}
        className={cn(
          'transition-opacity',
          column ? 'min-h-0 flex-1 overflow-y-auto border-t border-line' : 'overflow-hidden rounded-card border border-line bg-surface',
          loading && 'opacity-60',
        )}
      >
        {threads.length === 0 ? (
          <EmptyInbox filter={filter} side={side} t={t} />
        ) : (
          <ul className="divide-y divide-line">
            {threads.map((thread) => (
              <li key={thread.id}>
                <ThreadRow thread={thread} side={side} basePath={basePath} now={now} locale={locale} t={t} active={thread.id === activeId} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className={cn('u-press u-btn-secondary u-focus-ring self-center rounded-lg px-5 py-2.5 text-sm font-semibold text-ink', column && 'mb-3')}
        >
          {t('chat.inbox.loadMore')}
        </button>
      ) : null}

      {side === 'customer' ? <ChatSafetyNote text={t('chat.safety')} /> : null}
    </div>
  );
}

function ThreadRow({ thread, side, basePath, now, locale, t, active = false }) {
  const unread = thread.unread > 0;
  // Agent side: the customer spoke last and has not had an answer.
  const waiting = side === 'agent' && thread.lastSenderRole === 'customer' && !thread.blocked;
  const person = thread.counterpart;
  const name = person.name || (person.role === 'agent' ? t('chat.agentFallback') : t('chat.customer'));
  const fromMe = thread.lastSenderRole === side;
  const listing = thread.listing;
  const about = thread.propertyId
    ? listing
      ? [listing.category, listing.place, listing.priceLabel].filter(Boolean).join(' · ')
      : t('chat.inbox.listingGone')
    : t('chat.inbox.noListing');

  return (
    <Link
      href={`${basePath}/${thread.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex gap-3.5 px-4 py-3.5 text-inherit no-underline transition-colors hover:bg-canvas-alt sm:px-5',
        unread && 'bg-blue-tint/40',
        active && 'bg-blue-tint hover:bg-blue-tint',
      )}
    >
      <ChatAvatar person={person} t={t} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[0.9375rem] text-ink', unread ? 'font-bold' : 'font-semibold')}>
            {person.agency && person.agency !== name ? `${name} · ${person.agency}` : name}
          </span>
          <span className={cn('u-tabular flex-none text-[0.8125rem]', unread ? 'font-semibold text-blue' : 'text-ink-45')}>
            {chatInboxTime(thread.lastMessageAt, now, locale, t)}
          </span>
        </span>
        <span className="truncate text-[0.8125rem] text-ink-45">{about}</span>
        <span className="mt-0.5 flex items-center gap-2">
          <span
            className={cn(
              'line-clamp-2 min-w-0 flex-1 text-[0.875rem] leading-snug',
              unread ? 'font-semibold text-ink' : 'text-ink-45',
            )}
          >
            {fromMe ? t('chat.inbox.you') : ''}
            {thread.lastMessagePreview}
          </span>
          {unread ? (
            <span className="u-tabular inline-flex h-[1.375rem] min-w-[1.375rem] flex-none items-center justify-center rounded-full bg-blue px-1.5 text-[0.75rem] font-bold text-white">
              <span className="sr-only">{t('chat.inbox.unreadLabel', { count: thread.unread })}</span>
              <span aria-hidden="true">{thread.unread}</span>
            </span>
          ) : null}
        </span>
        {waiting ? (
          <span className="mt-1.5 inline-flex h-6 items-center gap-1.5 self-start rounded-full bg-warning-tint px-2.5 text-[0.75rem] font-bold text-warning-ink">
            <Clock3 strokeWidth={2.25} className="h-3.5 w-3.5" aria-hidden="true" />
            {t('chat.agent.waitingChip', { time: chatWaitLabel(thread.lastMessageAt, now, locale) })}
          </span>
        ) : null}
        {thread.blocked ? (
          <span className="mt-1 text-[0.75rem] font-semibold text-ink-45">{t('chat.thread.blockedByOther')}</span>
        ) : null}
      </span>
    </Link>
  );
}

function EmptyInbox({ filter, side, t }) {
  if (filter !== 'all') {
    return (
      <p className="flex items-center justify-center gap-2 px-5 py-12 text-center text-[0.9375rem] text-ink-45">
        {filter === 'unread' ? <CalendarCheck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" /> : null}
        {t(filter === 'unread' ? 'chat.inbox.emptyUnread' : 'chat.inbox.emptyArchived')}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-tint text-blue">
        <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
      </span>
      <h2 className="u-title-section text-ink">{t(side === 'agent' ? 'chat.agent.emptyTitle' : 'chat.inbox.emptyTitle')}</h2>
      <p className="max-w-[26rem] text-[0.9375rem] leading-relaxed text-ink-70">{t(side === 'agent' ? 'chat.agent.emptyBody' : 'chat.inbox.emptyBody')}</p>
      {side === 'agent' ? null : (
      <Link
        href="/listings"
        className="u-press mt-2 inline-flex items-center gap-2 rounded-lg bg-blue px-5 py-3 text-sm font-semibold text-white no-underline transition-colors hover:bg-blue-deep"
      >
        <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('chat.inbox.emptyCta')}
      </Link>
      )}
    </div>
  );
}
