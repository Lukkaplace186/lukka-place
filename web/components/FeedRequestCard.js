'use client';

import Link from '@/components/LocaleLink';
import { MessageCircleQuestion } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * "Pas encore trouvé ?" inside the /listings feed (2026-11-21). A visitor who
 * is not ready to write to an agent leaves their number and what they want on
 * /trouver-pour-moi (no account); agencies covering the commune answer on
 * WhatsApp. The href comes from lib/guestRequestRules.js feedRequestHref.
 */
export default function FeedRequestCard({ href }) {
  const t = useT();
  return (
    <aside
      aria-labelledby="feed-request-title"
      className="flex flex-col gap-3 rounded-card border border-blue/30 bg-blue-tint px-5 py-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 gap-3">
        <MessageCircleQuestion strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-blue-deep" aria-hidden="true" />
        <div className="min-w-0">
          <p id="feed-request-title" className="text-[0.9375rem] font-semibold text-ink">{t('listings.results.feedRequestTitle')}</p>
          <p className="mt-1 text-[0.8125rem] text-ink-70">{t('listings.results.feedRequestBody')}</p>
        </div>
      </div>
      <Link
        href={href}
        data-feed-request="1"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-blue px-5 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-blue-deep"
      >
        {t('listings.results.feedRequestCta')}
      </Link>
    </aside>
  );
}
