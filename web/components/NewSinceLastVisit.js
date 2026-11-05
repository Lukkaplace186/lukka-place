'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/LocaleLink';
import { Sparkles, X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { nextVisitStamps } from '@/lib/visitStamps';

/**
 * "✨ 5 nouveaux biens depuis votre dernière visite" (2026-11-03), on
 * /listings and the Espace Client's Accueil.
 *
 * A "visit" is a browsing session on this device: a gap of more than
 * SESSION_GAP_MS since the last page that mounted this starts a new one, and
 * "since your last visit" means since the previous session's last page. Both
 * stamps live in localStorage only — nothing about the visitor is sent; the
 * server is asked one anonymous question ("how many since this instant?",
 * app/api/listings/new-since). The link opens exactly the counted listings
 * (`?ids=`), so the number and the page always agree.
 *
 * Renders nothing on the server, on a first visit, when nothing is new, on
 * the very page the link opens, or once closed for this session.
 */
const LAST_KEY = 'lp_visit_last';
const PREV_KEY = 'lp_visit_prev';
const DISMISS_KEY = 'lp_new_since_dismissed';

function readNumber(storage, key) {
  try {
    const value = Number(storage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage.setItem(key, String(value));
  } catch {
    // Private mode / blocked storage: the banner simply never shows.
  }
}


export default function NewSinceLastVisit({ className = '' }) {
  const t = useT();
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return undefined;
    const stamps = nextVisitStamps({
      last: readNumber(window.localStorage, LAST_KEY),
      prev: readNumber(window.localStorage, PREV_KEY),
      now: Date.now(),
    });
    write(window.localStorage, LAST_KEY, stamps.last);
    if (stamps.prev != null) write(window.localStorage, PREV_KEY, stamps.prev);

    const since = stamps.since;
    if (since == null) return undefined;
    if (new URLSearchParams(window.location.search).has('ids')) return undefined;
    if (window.sessionStorage && readNumber(window.sessionStorage, DISMISS_KEY) === since) return undefined;

    const controller = new AbortController();
    fetch(`/api/listings/new-since?since=${since}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && json.count > 0 && Array.isArray(json.ids) && json.ids.length > 0) {
          setResult({ since, count: json.count, href: `/listings?ids=${json.ids.join(',')}&sort=newest` });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!result) return null;

  function dismiss() {
    if (window.sessionStorage) write(window.sessionStorage, DISMISS_KEY, result.since);
    setResult(null);
  }

  return (
    <div
      className={cn(
        'u-reveal flex items-center gap-3 rounded-2xl border border-blue/20 bg-blue-tint px-4 py-3 text-blue-deep',
        className,
      )}
      role="status"
    >
      <Sparkles strokeWidth={2} className="h-5 w-5 shrink-0 text-blue" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[0.875rem] font-semibold leading-snug">
        {t('listings.newSince.title', { count: result.count })}
      </p>
      <Link
        href={result.href}
        className="u-press shrink-0 rounded-full bg-blue px-3.5 py-1.5 text-[0.8125rem] font-bold text-white"
      >
        {t('listings.newSince.cta')}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('listings.newSince.dismiss')}
        className="u-hit relative shrink-0 rounded-full p-1 text-blue-deep/70 hover:text-blue-deep"
      >
        <X strokeWidth={2} className="h-4 w-4" />
      </button>
    </div>
  );
}
