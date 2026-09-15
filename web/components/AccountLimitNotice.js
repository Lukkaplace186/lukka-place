'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { ACCOUNT_LIMIT_EVENT, MAX_FAVORITES, MAX_SAVED_SEARCHES } from '@/lib/accountLimits';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const NOTICES = {
  favorites: { key: 'account.limits.favorites', max: MAX_FAVORITES, href: '/compte/client' },
  savedSearches: { key: 'account.limits.savedSearches', max: MAX_SAVED_SEARCHES, href: '/compte/client?tab=alertes' },
};

/**
 * Says why a heart or an alert did not stick. Mounted once in the site
 * layout because the save buttons live on every listing surface, none of
 * which sits inside the portal's ToastProvider. Listens for the event
 * lib/accountFavorites.js raises on a 409 from /api/account/*.
 */
export default function AccountLimitNotice() {
  const t = useT();
  const [kind, setKind] = useState(null);

  useEffect(() => {
    function onLimit(event) {
      if (NOTICES[event.detail?.kind]) setKind(event.detail.kind);
    }
    window.addEventListener(ACCOUNT_LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(ACCOUNT_LIMIT_EVENT, onLimit);
  }, []);

  useEffect(() => {
    if (!kind) return undefined;
    const timer = setTimeout(() => setKind(null), 8000);
    return () => clearTimeout(timer);
  }, [kind]);

  if (!kind) return null;
  const notice = NOTICES[kind];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div
        role="alert"
        className="u-lift pointer-events-auto flex max-w-md items-start gap-3 rounded-lg bg-surface px-4 py-3 text-sm text-ink shadow-sm"
      >
        <p className="leading-snug">
          {t(notice.key, { max: notice.max })}{' '}
          <Link href={notice.href} className="font-semibold text-blue-deep underline hover:no-underline">
            {t('account.limits.manage')}
          </Link>
        </p>
        <button
          type="button"
          onClick={() => setKind(null)}
          aria-label={t('common.actions.close')}
          className="u-press -mr-1 shrink-0 rounded-md p-1 text-ink-45 hover:text-ink"
        >
          <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
