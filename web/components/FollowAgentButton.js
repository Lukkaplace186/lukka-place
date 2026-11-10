'use client';

import { useState, useTransition } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/**
 * "Suivre" on an agency's public page (C4, 2026-11-10). Signed in: toggles
 * through /api/account/follows and says what following does. Signed out: a
 * link to sign in that comes back here. Each new listing of a followed
 * agency is pushed by the Lukka Place app (never WhatsApp).
 */
export default function FollowAgentButton({ agentId, signedIn = false, initialFollowing = false, returnPath }) {
  const t = useT();
  const [following, setFollowing] = useState(initialFollowing);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <a
        href={`/compte/connexion?next=${encodeURIComponent(returnPath || `/agents/${agentId}`)}`}
        className="u-press inline-flex h-10 items-center gap-2 self-start rounded-full px-4 text-sm font-semibold text-blue-deep ring-1 ring-inset ring-line transition-colors hover:bg-blue-tint"
      >
        <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('account.follow.follow')}
      </a>
    );
  }

  function toggle() {
    const next = !following;
    setError(null);
    setFollowing(next);
    startTransition(async () => {
      try {
        const response = await fetch('/api/account/follows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ agentId, follow: next }),
        });
        if (!response.ok) throw new Error(String(response.status));
      } catch {
        setFollowing(!next);
        setError(t('account.follow.failed'));
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        className={cn(
          'u-press inline-flex h-10 items-center gap-2 self-start rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-60',
          following ? 'bg-blue text-white' : 'text-blue-deep ring-1 ring-inset ring-line hover:bg-blue-tint',
        )}
      >
        {following
          ? <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          : <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />}
        {following ? t('account.follow.following') : t('account.follow.follow')}
      </button>
      <p className="text-xs text-ink-45">{error || (following ? t('account.follow.hintOn') : t('account.follow.hintOff'))}</p>
    </div>
  );
}
