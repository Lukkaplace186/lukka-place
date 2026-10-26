'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import ListingQuickShare from '@/components/ListingQuickShare';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * "Carte réseaux sociaux" on /admin/listings/[id] (2026-10-26): Lukka Place
 * makes the 4:5 feed card of any live listing for its own Instagram, Facebook
 * and TikTok pages — the same card and caption an agent makes from Mes biens
 * (ListingQuickShare, audience "team"), leading back to the listing on
 * lukkaplace.com. The page renders this only for a listing that is live
 * (shareBlocker), since the card's link would otherwise lead to a 404.
 */
export default function TeamSocialCardButton({ listing }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-press inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-semibold text-blue-deep ring-1 ring-inset ring-ink-25 hover:bg-canvas-alt"
      >
        <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        {t('admin.moderation.socialCard')}
      </button>
      <ListingQuickShare listing={listing} open={open} onOpenChange={setOpen} audience="team" />
    </>
  );
}
