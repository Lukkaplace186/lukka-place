'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { INBOX_SEEN_COOKIE } from '@/lib/agentInbox';

/**
 * Marks the Demandes inbox as seen on this device (lib/agentDashboard.js's
 * `waitingCount`): stamps INBOX_SEEN_COOKIE with the server's render time,
 * then — only when a badge was showing — refreshes so the layout's tab badge
 * and the header bell drop to zero without waiting for the next navigation.
 * Renders nothing. `cookieName` lets another "seen" stamp reuse it — the
 * Espace Client's Enregistrés tab (lib/favoriteSeen.js).
 */
export default function InboxSeenMarker({ seenAt, badge = 0, cookieName = INBOX_SEEN_COOKIE }) {
  const router = useRouter();
  useEffect(() => {
    if (!Number.isFinite(seenAt)) return;
    document.cookie = `${cookieName}=${seenAt}; path=/; max-age=31536000; samesite=lax`;
    if (badge > 0) router.refresh();
  }, [seenAt, badge, cookieName, router]);
  return null;
}
