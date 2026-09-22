'use client';

import { useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * The Favoris / Alertes switch. Still two real URLs (`/compte/client` and
 * `?tab=alertes`), so a switch stays linkable and the server still fetches
 * only the active board — Alertes re-runs every saved search and must not
 * be computed for someone looking at their favourites.
 *
 * What changed is how a tap feels. As plain <Link>s the pill did not move
 * until the server had answered, so on a Kinshasa 3G connection a tap looked
 * ignored for a second or more. The active pill is now optimistic: it moves
 * on the tap, the page's keyed Suspense shows the board's skeleton, and the
 * real content replaces it when it arrives. Both targets are prefetched.
 */
export default function SavedSubTabs({ view, tabs }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [active, setActive] = useOptimistic(view);

  return (
    <div className="mb-5 inline-flex gap-1 rounded-full bg-canvas-deep p-1 sm:mb-7">
      {tabs.map(({ key, href, label }) => (
        <Link
          key={key}
          href={href}
          prefetch
          aria-current={active === key ? 'page' : undefined}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
            event.preventDefault();
            if (active === key) return;
            startTransition(() => {
              setActive(key);
              router.push(href, { scroll: false });
            });
          }}
          className={cn(
            'rounded-full px-4 py-2 text-[0.8125rem] font-bold transition-colors',
            active === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-45 hover:text-ink',
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
