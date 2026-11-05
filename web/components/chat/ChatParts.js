'use client';

import Link from 'next/link';
import { BadgeCheck, ImageIcon } from 'lucide-react';
import AgentMonogram from '@/components/AgentMonogram';
import SafeImage from '@/components/SafeImage';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * Small pieces shared by the inbox, the conversation and the first-message
 * screen (Messagerie, web/CLAUDE.md). Design: the "Messagerie Lukka Place"
 * canvas — royal blue for the reader's own bubbles and every action, white
 * cards on the page ground, hairlines instead of shadows.
 */

/** The other side's avatar: the agent's logo or initials, a customer's initials. A blue tick for a verified agent. */
export function ChatAvatar({ person, size = 'md', t }) {
  const box = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-10 w-10' : 'h-12 w-12';
  const text = size === 'lg' ? 'text-[1.25rem]' : size === 'sm' ? 'text-[0.9375rem]' : 'text-[1.0625rem]';
  return (
    <span className="relative inline-flex h-fit flex-none self-start">
      <AgentMonogram logoUrl={person?.image || null} name={person?.name || null} className={box} textClassName={text} />
      {person?.role === 'agent' && person?.verified ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-blue text-white ring-2 ring-surface"
          title={t('chat.verified')}
        >
          <BadgeCheck strokeWidth={2.25} className="h-3.5 w-3.5" aria-label={t('chat.verified')} />
        </span>
      ) : null}
    </span>
  );
}

/** The listing a conversation is about, as a compact row. Null card + an id = no longer online. */
export function ChatListingRow({ listing, propertyId, t, compact = false, className = '' }) {
  if (!propertyId) return null;
  if (!listing) {
    return (
      <div className={cn('flex items-center gap-3 text-[0.8125rem] text-ink-45', className)}>
        <span className="grid h-12 w-12 flex-none place-items-center rounded-[10px] bg-canvas-alt">
          <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        {t('chat.inbox.listingGone')}
      </div>
    );
  }
  const title = listing.category;
  return (
    <Link
      href={`/listings/${listing.id}`}
      className={cn('group flex min-w-0 items-center gap-3 rounded-xl text-inherit no-underline', className)}
    >
      <span className={cn('relative flex-none overflow-hidden rounded-[10px] bg-canvas-alt', compact ? 'h-12 w-12' : 'h-14 w-14')}>
        {listing.image ? (
          <SafeImage src={listing.image} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center text-ink-35">
            <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.875rem] font-semibold text-ink group-hover:underline group-hover:underline-offset-2">{title || t('chat.thread.viewListing')}</span>
        {listing.place ? <span className="truncate text-[0.8125rem] text-ink-45">{listing.place}</span> : null}
        <span className="u-tabular text-[0.9375rem] font-bold tracking-[-0.02em] text-ink">{listing.priceLabel}</span>
      </span>
    </Link>
  );
}
