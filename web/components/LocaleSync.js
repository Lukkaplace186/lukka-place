'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/i18n/config';
import { readStoredLocale, useLocale } from '@/lib/i18n/client';

/**
 * Reconciles the localStorage mirror back onto the cookie.
 *
 * The brief asks for the preference in both stores, and this is the case
 * that makes the second one earn its place rather than just duplicate the
 * first. The cookie is the only thing the server can read, but it is also
 * the one that goes missing — a year-long expiry lapses, a privacy setting
 * or a "clear cookies" sweep drops it, or the visitor arrives in a context
 * that stripped it. localStorage typically survives all of those.
 *
 * So: on mount, if the browser remembers a language the request did not
 * carry, restore the cookie and refresh so the server re-renders in it.
 * Without this the visitor would silently fall back to French and have to
 * pick English again after every such loss.
 *
 * Renders nothing, and does nothing at all in the common case where the two
 * already agree — no refresh, no extra request.
 */
export default function LocaleSync() {
  const locale = useLocale();
  const router = useRouter();

  useEffect(() => {
    const stored = readStoredLocale();
    // Nothing stored means the visitor never chose; the server's default
    // stands and there is nothing to reconcile.
    if (!stored || stored === locale) return;

    document.cookie = `${LOCALE_COOKIE}=${stored}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    router.refresh();
  }, [locale, router]);

  return null;
}
