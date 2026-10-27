'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import {
  AD_QUEUE_COOKIE, CONSENT_COOKIE, CONSENT_MAX_AGE, consentRequired, newEventId, parseAdQueue,
} from '@/lib/adTrackingRules';
import { dispatchAdEvent } from '@/lib/adEvents';
import { loadMetaPixel, loadTiktokPixel } from '@/lib/adPixelLoaders';

function readCookie(name) {
  try {
    return new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(document.cookie)?.[1] || null;
  } catch {
    return null;
  }
}

function writeCookie(name, value, maxAge) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies refused: nothing is sent, which is the safe side.
  }
}

/**
 * Meta and TikTok pixels on the storefront (growth plan items 5 and 7),
 * mounted once in app/(site)/layout.js with the ids from /admin/settings.
 * Renders nothing when neither id is set.
 *
 * - A browser on a European time zone (lib/adTrackingRules.js) is asked first:
 *   a small banner, Accept / Refuse, remembered 180 days in `lp_consent`.
 *   Until a yes, no pixel loads and no event leaves — not even the server
 *   copy, which checks the same cookie.
 * - Everyone else is not asked (`lp_consent=na`) and the pixels load at once.
 * - PageView on every route change; events fired before the decision wait in
 *   `window.__lpAdQueue`; events a server action queued (`lp_adq`: a verified
 *   signup, a visit request) are fired here on the next page.
 */
export default function AdTracking({ metaPixelId = null, tiktokPixelId = null }) {
  const t = useT();
  const pathname = usePathname();
  const [state, setState] = useState('pending');
  const lastPath = useRef(null);
  const enabled = Boolean(metaPixelId || tiktokPixelId);

  useEffect(() => {
    if (!enabled) return;
    window.__lpAds = { state: 'pending', meta: metaPixelId, tiktok: tiktokPixelId };
    const stored = readCookie(CONSENT_COOKIE);
    let timeZone = '';
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
      timeZone = '';
    }
    let decided;
    if (!consentRequired({ timeZone })) {
      if (stored !== 'na') writeCookie(CONSENT_COOKIE, 'na', CONSENT_MAX_AGE);
      decided = 'on';
    } else if (stored === 'granted') decided = 'on';
    else if (stored === 'denied') decided = 'off';
    else decided = 'ask';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- decided from browser-only signals after mount
    setState(decided);
  }, [enabled, metaPixelId, tiktokPixelId]);

  useEffect(() => {
    if (!enabled || state === 'pending' || state === 'ask') return;
    window.__lpAds = { state, meta: metaPixelId, tiktok: tiktokPixelId };
    const queued = window.__lpAdQueue || [];
    window.__lpAdQueue = [];
    if (state !== 'on') return;
    loadMetaPixel(metaPixelId);
    loadTiktokPixel(tiktokPixelId);
    for (const event of queued) dispatchAdEvent(event.name, event.params, event.eventId);
  }, [enabled, state, metaPixelId, tiktokPixelId]);

  // PageView per route, plus whatever a server action queued for this page.
  useEffect(() => {
    if (!enabled || state !== 'on' || lastPath.current === pathname) return;
    lastPath.current = pathname;
    dispatchAdEvent('PageView', {}, newEventId('pv'), { serverCopy: false });
    if (window.ttq?.page) window.ttq.page();
    const fromServer = parseAdQueue(readCookie(AD_QUEUE_COOKIE));
    if (fromServer.length) {
      writeCookie(AD_QUEUE_COOKIE, '', 0);
      // The server already sent its copy of these: browser only, same id.
      for (const event of fromServer) dispatchAdEvent(event.n, event.p, event.id, { serverCopy: false });
    }
  }, [enabled, state, pathname]);

  if (!enabled || state !== 'ask') return null;

  const choose = (value) => {
    writeCookie(CONSENT_COOKIE, value, CONSENT_MAX_AGE);
    setState(value === 'granted' ? 'on' : 'off');
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t('footer.consent.title')}
      className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-xl rounded-card border border-line bg-surface p-4 shadow-lg sm:bottom-5"
    >
      <p className="u-micro text-ink-70">
        {t('footer.consent.text')}{' '}
        <Link href="/confidentialite" className="font-semibold text-blue-deep underline">{t('footer.consent.more')}</Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => choose('denied')} className="u-press h-10 flex-1 rounded-lg text-sm font-bold text-ink ring-1 ring-inset ring-line">
          {t('footer.consent.refuse')}
        </button>
        <button type="button" onClick={() => choose('granted')} className="u-press h-10 flex-1 rounded-lg bg-blue text-sm font-bold text-white">
          {t('footer.consent.accept')}
        </button>
      </div>
    </div>
  );
}
