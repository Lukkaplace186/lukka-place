'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { INBOX_SEEN_COOKIE } from '@/lib/agentInbox';

/**
 * Marks the Demandes inbox as seen on this device (lib/agentDashboard.js's
 * `waitingCount`): stamps INBOX_SEEN_COOKIE with the server's render time,
 * then — only when a badge was showing — refreshes so the layout's tab badge
 * and the header bell drop to zero without waiting for the next navigation.
 * Renders nothing.
 */
export default function InboxSeenMarker({ seenAt, badge = 0 }) {
  const router = useRouter();
  useEffect(() => {
    if (!Number.isFinite(seenAt)) return;
    document.cookie = `${INBOX_SEEN_COOKIE}=${seenAt}; path=/; max-age=31536000; samesite=lax`;
    if (badge > 0) router.refresh();
  }, [seenAt, badge, router]);
  return null;
}
