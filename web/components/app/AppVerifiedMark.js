'use client';

import { BadgeCheck } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

/**
 * "Agent vérifié" on an app listing photo, in brass: the app's one use of the
 * prestige accent (DESIGN.md, Secondary). Shown only when the listing's agent
 * holds the tier the team grants after checking documents
 * (`agent_verification_level`, NULL for a standard agent in lib/listings.js);
 * nothing otherwise, never a grey "non vérifié". Deep Brass text on white,
 * the text-safe pairing (7.3:1).
 */
export default function AppVerifiedMark({ listing, className }) {
  const t = useT();
  if (!listing?.agent_verification_level) return null;
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 rounded-full bg-surface py-1 pl-1.5 pr-2.5 text-[0.75rem] font-bold text-brass-deep shadow-sm',
        className,
      )}
    >
      <BadgeCheck strokeWidth={2} className="h-4 w-4" aria-hidden="true" />
      {t('chat.verified')}
    </span>
  );
}
