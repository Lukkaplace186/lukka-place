'use client';

import { useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * The Favoris / Alertes switch. Still two real URLs (`/compte/client/favoris`
 * and `?tab=alertes`), so a switch stays linkable and the server still fetches
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
    <div className="mb-4 flex w-full rounded-xl bg-canvas-deep p-[3px] sm:mb-6 sm:inline-flex sm:w-auto">
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
            'inline-flex min-h-10 flex-1 items-center justify-center rounded-[0.5625rem] px-5 text-sm font-bold transition-colors sm:flex-none',
            active === key ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(16,26,46,.08)]' : 'text-ink-45 hover:text-ink',
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
