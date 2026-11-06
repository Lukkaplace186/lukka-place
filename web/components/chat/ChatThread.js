'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowDown, ArrowLeft, Check, CheckCheck, Clock3, House, MoreVertical } from 'lucide-react';
import ChatComposer from './ChatComposer';
import { ChatAvatar, ChatListingRow } from './ChatParts';
import ShareListingsDialog from './ShareListingsDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { chatErrorKey, chatRequest, newClientId } from '@/lib/chatClient';
import { notifyChatUnreadChanged } from '@/lib/useChatUnread';
import { chatClock, chatDayKey, chatDayLabel, chatWaitLabel } from '@/lib/chatTime';
import { CHAT_POLL, CHAT_REPORT_NOTE_MAX, CHAT_REPORT_REASONS } from '@/lib/chatRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

const NEAR_BOTTOM_PX = 120;

/** Wall clock for the idle timer; out of the component so render stays pure. */
const nowMs = () => Date.now();

function confirmedMaxId(messages) {
  return messages.reduce((max, m) => (typeof m.id === 'number' && m.id > max ? m.id : max), 0);
}

/**
 * One conversation (Messagerie — web/CLAUDE.md): the customer's at
 * /messages/[id] (`variant="site"`, a centred full-height column), the
 * agent's at /compte/agent/messages/[id] (`side="agent" variant="agent"`,
 * filling the middle column of the three-column layout). The agent also gets
 * `quickReplies` above the field, a "Partager un bien" button
 * (`shareableListings`) and a banner while the customer waits for an answer.
 *
 * - Polls `GET …/messages?after=<last id>` every 4 s, every 15 s after a
 *   quiet minute, never while the tab is hidden, at once on return.
 * - Sends optimistically with a client id: a message shows at once, a
 *   failure stays on screen with "Réessayer", and a retry (or a poll that
 *   brings the message back first) never makes a duplicate.
 * - Marks read with a POST only while the page is visible.
 */
export default function ChatThread({
  side = 'customer',
  variant = 'site',
  thread: initialThread,
  initialMessages,
  initialHasMore,
  serverNow,
  backHref,
  quickReplies = [],
  shareableListings = null,
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const threadId = initialThread.id;

  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [otherLastReadId, setOtherLastReadId] = useState(initialThread.otherLastReadId);
  const [blocked, setBlocked] = useState(initialThread.blocked);
  const [blockedBy, setBlockedBy] = useState(initialThread.blockedBy);
  const [archived, setArchived] = useState(initialThread.archived);
  const [now, setNow] = useState(serverNow);
  const [errorKey, setErrorKey] = useState(null);
  const [showNewPill, setShowNewPill] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const listRef = useRef(null);
  const lastIdRef = useRef(confirmedMaxId(initialMessages));
  const lastReadSentRef = useRef(initialThread.myLastReadId);
  const lastActivityRef = useRef(0);
  const inFlightRef = useRef(false);
  const goneRef = useRef(false);
  const keepOffsetRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const person = initialThread.counterpart;
  const name = person.name || (person.role === 'agent' ? t('chat.agentFallback') : t('chat.customer'));

  const isNearBottom = () => {
    const el = listRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };
  const scrollToBottom = (smooth = false) => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setShowNewPill(false);
  };

  const markRead = useCallback(async () => {
    const upTo = lastIdRef.current;
    if (!upTo || upTo <= lastReadSentRef.current || document.visibilityState !== 'visible') return;
    lastReadSentRef.current = upTo;
    const result = await chatRequest(`/threads/${threadId}/read`, { method: 'POST', side, body: { upTo } });
    // The menu badge and the tab title drop now, not on the next page.
    if (result.ok) notifyChatUnreadChanged();
  }, [threadId, side]);

  /** Server messages in; a pending copy with the same client id is replaced, never duplicated. */
  const merge = useCallback((incoming) => {
    if (!incoming?.length) return;
    setMessages((current) => {
      const next = [...current];
      for (const message of incoming) {
        const byId = next.findIndex((m) => m.id === message.id);
        if (byId >= 0) continue;
        const pending = message.clientId ? next.findIndex((m) => m.clientId === message.clientId && typeof m.id !== 'number') : -1;
        if (pending >= 0) next[pending] = message;
        else next.push(message);
      }
      return next;
    });
    lastIdRef.current = Math.max(lastIdRef.current, confirmedMaxId(incoming));
  }, []);

  const poll = useCallback(async () => {
    if (goneRef.current || inFlightRef.current || document.visibilityState !== 'visible') return;
    inFlightRef.current = true;
    try {
      const result = await chatRequest(`/threads/${threadId}/messages`, { side, query: { after: String(lastIdRef.current) } });
      // Signed out elsewhere, or the conversation is gone: stop asking. A
      // send still answers (and sends a signed-out reader to log in).
      if (result.status === 401 || result.status === 404) goneRef.current = true;
      if (!result.ok) return;
      const { messages: incoming, otherLastReadId: readId, blocked: isBlocked, blockedBy: by } = result.data;
      setOtherLastReadId(readId);
      setBlocked(isBlocked);
      setBlockedBy(by);
      setNow(new Date().toISOString());
      if (incoming.length) {
        stickToBottomRef.current = isNearBottom();
        merge(incoming);
        if (incoming.some((m) => m.senderRole !== side)) {
          lastActivityRef.current = Date.now();
          markRead();
          if (!stickToBottomRef.current) setShowNewPill(true);
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [threadId, side, merge, markRead]);

  // The poll loop: a chain of timeouts, so a slow answer never stacks requests.
  useEffect(() => {
    lastActivityRef.current = Date.now();
    let timer = null;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      const idle = Date.now() - lastActivityRef.current > CHAT_POLL.idleAfterMs;
      timer = window.setTimeout(async () => {
        await poll();
        schedule();
      }, idle ? CHAT_POLL.idleMs : CHAT_POLL.activeMs);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      lastActivityRef.current = Date.now();
      window.clearTimeout(timer);
      poll().then(() => {
        markRead();
        schedule();
      });
    };
    schedule();
    markRead();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [poll, markRead]);

  // Keep the view where the reader expects it: at the bottom when they were
  // there, still on the same message after older ones are added above.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keepOffsetRef.current != null) {
      el.scrollTop = el.scrollHeight - keepOffsetRef.current;
      keepOffsetRef.current = null;
      return;
    }
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    const firstId = messages.find((m) => typeof m.id === 'number')?.id;
    if (!firstId || loadingOlder) return;
    setLoadingOlder(true);
    const result = await chatRequest(`/threads/${threadId}/messages`, { side, query: { before: String(firstId) } });
    setLoadingOlder(false);
    if (!result.ok) return;
    const el = listRef.current;
    keepOffsetRef.current = el ? el.scrollHeight - el.scrollTop : null;
    stickToBottomRef.current = false;
    setMessages((current) => [...result.data.messages.filter((m) => !current.some((c) => c.id === m.id)), ...current]);
    setHasMore(result.data.hasMore);
  }

  async function deliver(pending) {
    setMessages((current) => current.map((m) => (m.clientId === pending.clientId ? { ...m, status: 'sending' } : m)));
    const result = await chatRequest(`/threads/${threadId}/messages`, {
      method: 'POST',
      side,
      body:
        pending.kind === 'listing'
          ? { kind: 'listing', propertyId: pending.propertyId, clientId: pending.clientId }
          : { body: pending.body, clientId: pending.clientId },
    });
    if (result.ok) {
      stickToBottomRef.current = true;
      merge([result.data.message]);
      setErrorKey(null);
      return;
    }
    if (result.status === 401) {
      // The session ended (logout elsewhere, a password reset): sign in and come back here.
      const login = side === 'agent' ? '/compte/agent/connexion' : '/compte/connexion';
      router.push(`${login}?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const code = result.status === 0 ? 'network' : result.data?.error;
    if (code === 'blocked') {
      setBlocked(true);
      poll();
    }
    setErrorKey(chatErrorKey(code));
    setMessages((current) => current.map((m) => (m.clientId === pending.clientId ? { ...m, status: 'failed' } : m)));
  }

  function send(text) {
    const clientId = newClientId();
    const pending = { id: `pending-${clientId}`, clientId, senderRole: side, kind: 'text', body: text, createdAt: new Date().toISOString(), status: 'sending' };
    lastActivityRef.current = nowMs();
    stickToBottomRef.current = true;
    setMessages((current) => [...current, pending]);
    deliver(pending);
    return true;
  }

  /** Agent: each picked listing becomes its own card message, sent in order. */
  async function shareListings(cards) {
    lastActivityRef.current = nowMs();
    stickToBottomRef.current = true;
    const pendings = cards.map((card) => {
      const clientId = newClientId();
      return { id: `pending-${clientId}`, clientId, senderRole: side, kind: 'listing', body: null, propertyId: card.id, listing: card, createdAt: new Date().toISOString(), status: 'sending' };
    });
    setMessages((current) => [...current, ...pendings]);
    for (const pending of pendings) {
      // One after another keeps their order in the thread.
      await deliver(pending);
    }
  }

  async function toggleArchive() {
    const result = await chatRequest(`/threads/${threadId}/archive`, { method: 'POST', side, body: { archived: !archived } });
    if (!result.ok) return setErrorKey(chatErrorKey(result.data?.error));
    setArchived(!archived);
    if (!archived) router.push(backHref);
  }

  async function changeBlock(next) {
    const result = await chatRequest(`/threads/${threadId}/block`, { method: 'POST', side, body: { blocked: next } });
    setBlockOpen(false);
    if (!result.ok) return setErrorKey(chatErrorKey(result.data?.error));
    setBlocked(next);
    setBlockedBy(next ? side : null);
  }

  // Day dividers, and which of my messages carries the read/sent line (the last one).
  const rows = useMemo(() => {
    const days = messages.map((message) => chatDayKey(message.createdAt));
    return messages.map((message, i) => ({
      message,
      divider: i === 0 || days[i] !== days[i - 1] ? chatDayLabel(message.createdAt, now, locale, t) : null,
    }));
  }, [messages, now, locale, t]);
  const lastMine = [...messages].reverse().find((m) => m.senderRole === side);
  // Agent side: the last message is the customer's — they are waiting on us.
  const lastMessage = messages[messages.length - 1];
  const waitingSince = side === 'agent' && !blocked && lastMessage?.senderRole === 'customer' ? lastMessage.createdAt : null;

  return (
    <div
      className={cn(
        'flex w-full flex-col bg-canvas-alt',
        variant === 'agent' ? 'h-full min-h-0' : 'mx-auto h-[calc(100dvh-4rem)] max-w-[48rem] sm:border-x sm:border-line',
      )}
    >
      {/* Who, and about what */}
      <header className="flex-none border-b border-line bg-surface">
        <div className="flex items-center gap-2 px-2 py-2.5 sm:px-3">
          <Link
            href={backHref}
            aria-label={t('chat.thread.back')}
            className={cn(
              'u-press u-focus-ring grid h-11 w-11 flex-none place-items-center rounded-full text-ink transition-colors hover:bg-canvas-alt',
              // Beside the list on a computer, the agent needs no way back.
              variant === 'agent' && 'lg:hidden',
            )}
          >
            <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </Link>
          <ChatAvatar person={person} size="sm" t={t} />
          <div className="flex min-w-0 flex-1 flex-col pl-1">
            <h1 className="truncate text-[1rem] font-bold leading-tight text-ink">{name}</h1>
            <p className="truncate text-[0.8125rem] text-ink-45">
              {[person.agency && person.agency !== name ? person.agency : null, person.role === 'agent' && person.verified ? t('chat.verified') : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('chat.thread.menu')}
              className="u-focus-ring grid h-11 w-11 flex-none place-items-center rounded-full text-ink-70 transition-colors hover:bg-canvas-alt"
            >
              <MoreVertical strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onSelect={toggleArchive}>{t(archived ? 'chat.thread.unarchive' : 'chat.thread.archive')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {blocked && blockedBy === side ? (
                <DropdownMenuItem onSelect={() => changeBlock(false)}>{t('chat.thread.unblock')}</DropdownMenuItem>
              ) : !blocked ? (
                <DropdownMenuItem onSelect={() => setBlockOpen(true)}>{t('chat.thread.block')}</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setReportOpen(true)} className="text-danger">
                {t('chat.thread.report')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {initialThread.propertyId ? (
          <div className="border-t border-line px-4 py-2.5">
            <ChatListingRow listing={initialThread.listing} propertyId={initialThread.propertyId} t={t} compact />
          </div>
        ) : null}
      </header>

      {/* The conversation */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label={t('chat.title')}
          onScroll={() => {
            if (isNearBottom()) setShowNewPill(false);
          }}
          className="h-full overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        >
          {hasMore ? (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                onClick={loadOlder}
                disabled={loadingOlder}
                className="u-press rounded-full border border-line bg-surface px-4 py-2 text-[0.8125rem] font-semibold text-ink-70 hover:bg-canvas"
              >
                {t('chat.thread.older')}
              </button>
            </div>
          ) : null}
          <ol className="flex flex-col gap-1.5">
            {rows.map(({ message, divider }) => (
              <Fragment key={message.clientId || message.id}>
                {divider ? (
                  <li className="my-2 flex justify-center">
                    <span className="rounded-full border border-line bg-surface px-3 py-1 text-[0.75rem] font-semibold text-ink-45">{divider}</span>
                  </li>
                ) : null}
                <MessageBubble
                  message={message}
                  mine={message.senderRole === side}
                  showStatus={message === lastMine}
                  read={typeof message.id === 'number' && message.id <= otherLastReadId}
                  onRetry={() => deliver(message)}
                  locale={locale}
                  t={t}
                />
              </Fragment>
            ))}
          </ol>
        </div>
        {showNewPill ? (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="u-press absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-blue px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-md"
          >
            <ArrowDown strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
            {t('chat.thread.newMessages')}
          </button>
        ) : null}
      </div>

      {/* Reply */}
      <footer className="flex-none border-t border-line bg-surface px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4">
        {waitingSince ? (
          <p className="mb-2.5 flex items-center gap-2 rounded-lg bg-warning-tint px-3 py-2 text-[0.8125rem] text-warning-ink">
            <Clock3 strokeWidth={2} className="h-4 w-4 flex-none" aria-hidden="true" />
            {t('chat.agent.waitingBanner', { name, time: chatWaitLabel(waitingSince, now, locale) })}
          </p>
        ) : null}
        {errorKey ? (
          <p role="alert" className="mb-2 flex items-start gap-2 text-[0.8125rem] font-semibold text-danger">
            <AlertCircle strokeWidth={ICON_STROKE_WIDTH} className="mt-px h-4 w-4 flex-none" aria-hidden="true" />
            {t(errorKey)}
          </p>
        ) : null}
        {blocked ? (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-canvas-alt px-4 py-3 text-[0.875rem] text-ink-70">
            <span>{t(blockedBy === side ? 'chat.thread.blockedByMe' : 'chat.thread.blockedByOther')}</span>
            {blockedBy === side ? (
              <button type="button" onClick={() => changeBlock(false)} className="font-semibold text-blue-deep">
                {t('chat.thread.unblock')}
              </button>
            ) : null}
          </div>
        ) : (
          <ChatComposer
            onSend={send}
            t={t}
            autoFocus
            suggestions={quickReplies}
            leading={
              shareableListings ? (
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  aria-label={t('chat.agent.shareTitle')}
                  title={t('chat.agent.shareTitle')}
                  className="u-press u-focus-ring grid h-11 w-11 flex-none place-items-center rounded-full text-ink-70 transition-colors hover:bg-canvas-alt hover:text-blue-deep"
                >
                  <House strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null
            }
          />
        )}
      </footer>

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('chat.thread.block')}</DialogTitle>
            <DialogDescription>{t('chat.thread.blockConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setBlockOpen(false)} className="u-press u-btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold text-ink">
              {t('chat.report.cancel')}
            </button>
            <button type="button" onClick={() => changeBlock(true)} className="u-press rounded-lg bg-danger px-4 py-2.5 text-sm font-semibold text-white">
              {t('chat.thread.block')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} threadId={threadId} side={side} t={t} />
      {shareableListings ? (
        <ShareListingsDialog open={shareOpen} onOpenChange={setShareOpen} listings={shareableListings} onShare={shareListings} t={t} />
      ) : null}
    </div>
  );
}

function MessageBubble({ message, mine, showStatus, read, onRetry, locale, t }) {
  const failed = message.status === 'failed';
  const sending = message.status === 'sending';

  if (message.kind === 'system') {
    return (
      <li className="my-1 self-center px-3 text-center text-[0.8125rem] text-ink-45">{message.body}</li>
    );
  }

  return (
    <li className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {message.kind === 'listing' ? (
        <div className={cn('w-[min(22rem,88%)] rounded-2xl border border-line bg-surface p-3', mine ? 'rounded-br-md' : 'rounded-bl-md')}>
          <p className="mb-2 text-[0.75rem] font-semibold text-ink-45">{t('chat.thread.sharedListing')}</p>
          <ChatListingRow listing={message.listing} propertyId={message.propertyId} t={t} />
          {message.body ? <p className="mt-2.5 whitespace-pre-wrap break-words text-[0.9375rem] leading-snug text-ink">{message.body}</p> : null}
        </div>
      ) : (
        <div
          className={cn(
            'max-w-[82%] whitespace-pre-wrap break-words px-3.5 py-2 text-[0.9375rem] leading-[1.45] sm:max-w-[75%]',
            mine
              ? 'rounded-[1.125rem] rounded-br-md bg-blue text-white'
              : 'rounded-[1.125rem] rounded-bl-md border border-line bg-surface text-ink',
            sending && 'opacity-70',
            failed && 'bg-blue/60',
          )}
        >
          {message.body}
        </div>
      )}
      <span className="flex items-center gap-1 px-1 text-[0.6875rem] text-ink-45">
        <span className="u-tabular">{chatClock(message.createdAt, locale)}</span>
        {mine && failed ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-danger">{t('chat.thread.failed')}</span>
            <button type="button" onClick={onRetry} className="ml-1 font-semibold text-blue-deep underline underline-offset-2">
              {t('chat.thread.retry')}
            </button>
          </>
        ) : mine && showStatus ? (
          <>
            <span aria-hidden="true">·</span>
            {sending ? (
              <span>{t('chat.thread.sending')}</span>
            ) : read ? (
              <span className="inline-flex items-center gap-0.5 text-blue">
                <CheckCheck strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
                {t('chat.thread.read')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5">
                <Check strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
                {t('chat.thread.sent')}
              </span>
            )}
          </>
        ) : null}
      </span>
    </li>
  );
}

function ReportDialog({ open, onOpenChange, threadId, side, t }) {
  const [reason, setReason] = useState('scam');
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle');

  async function submit(event) {
    event.preventDefault();
    setState('sending');
    const result = await chatRequest(`/threads/${threadId}/report`, { method: 'POST', side, body: { reason, note } });
    setState(result.ok ? 'done' : 'error');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setState('idle');
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('chat.report.title')}</DialogTitle>
          <DialogDescription>{state === 'done' ? t('chat.report.done') : t('chat.report.lead')}</DialogDescription>
        </DialogHeader>
        {state === 'done' ? (
          <DialogFooter>
            <button type="button" onClick={() => onOpenChange(false)} className="u-press rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white">
              {t('common.actions.close')}
            </button>
          </DialogFooter>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="u-title-sub mb-1 text-ink">{t('chat.report.reasonLabel')}</legend>
              {CHAT_REPORT_REASONS.map((value) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3.5 text-[0.9375rem] text-ink has-[:checked]:border-blue has-[:checked]:bg-blue-tint">
                  <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="h-4 w-4 accent-[var(--blue)]" />
                  {t(`chat.report.reasons.${value}`)}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1.5 text-[0.875rem] font-semibold text-ink">
              {t('chat.report.note')}
              <textarea
                value={note}
                maxLength={CHAT_REPORT_NOTE_MAX}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                className="resize-none rounded-lg border border-line px-3 py-2 text-[0.9375rem] font-normal outline-none focus:border-blue"
              />
            </label>
            {state === 'error' ? <p className="text-[0.8125rem] font-semibold text-danger">{t('chat.errors.generic')}</p> : null}
            <DialogFooter>
              <button type="button" onClick={() => onOpenChange(false)} className="u-press u-btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold text-ink">
                {t('chat.report.cancel')}
              </button>
              <button type="submit" disabled={state === 'sending'} className="u-press rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white">
                {t('chat.report.submit')}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
