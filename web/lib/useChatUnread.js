'use client';

import { useEffect, useState } from 'react';
import { chatRequest } from './chatClient';
import { CHAT_POLL, unreadLabel } from './chatRules';

/**
 * Messagerie — the unread count behind every badge (customer header, agent
 * menu) and the "(3) …" in the browser tab title.
 *
 * Counts unread MESSAGES (GET /api/chat/unread). Refreshed every 30 s while
 * the tab is visible, on return to the tab, and at once when a conversation
 * changes it: ChatThread calls notifyChatUnreadChanged() once a read is
 * recorded, so the badge drops the moment a conversation is opened instead
 * of on the next page.
 */
export const CHAT_UNREAD_EVENT = 'lukka:chat-unread';

export function notifyChatUnreadChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAT_UNREAD_EVENT));
}

/**
 * @param {'customer'|'agent'} side
 * @param {{enabled?: boolean, initial?: number|null}} options  `enabled` false
 *   (signed out) makes no request and returns 0; `initial` is the server's
 *   count, shown until the first answer.
 * @returns {number}
 */
export function useChatUnread(side, { enabled = true, initial = null } = {}) {
  const [count, setCount] = useState(initial);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const result = await chatRequest('/unread', { side });
        if (!stopped && result.ok) setCount(Number(result.data?.messages) || 0);
      } finally {
        inFlight = false;
      }
    };
    load();
    const timer = window.setInterval(load, CHAT_POLL.inboxMs);
    window.addEventListener(CHAT_UNREAD_EVENT, load);
    document.addEventListener('visibilitychange', load);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener(CHAT_UNREAD_EVENT, load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [side, enabled]);

  return enabled ? Number(count) || 0 : 0;
}

const TITLE_PREFIX = /^\(\d+\+?\)\s/;

/**
 * Prefixes the browser tab title with the unread count — "(3) Messages —
 * Lukka Place" — and keeps it there when Next.js swaps the title on
 * navigation (it rewrites <title>, which a MutationObserver sees).
 */
export function useUnreadTitle(count) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_PREFIX, '');
      const wanted = count > 0 ? `(${unreadLabel(count)}) ${base}` : base;
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(TITLE_PREFIX, '');
    };
  }, [count]);
}
