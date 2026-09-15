'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw, WifiOff } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useOnline } from '@/lib/useOnline';
import { useT } from '@/lib/i18n/client';

/**
 * The error boundary body for the public site, the agent dashboard and the
 * agent portfolio pages (their `error.js` files are one line each).
 *
 * Before these existed, anything that threw while rendering — the engine
 * timing out, Postgres refusing a connection, a dropped 3G link mid-render —
 * replaced the whole window with Next's default English "This page couldn't
 * load", with no way back but the browser's own reload. This keeps the header
 * (or the agent sidebar) on screen, says in French what happened, and offers
 * a retry that re-renders only the failed segment. When the browser reports
 * no connection it says THAT instead, since "something went wrong" sends
 * people to contact support about their own data plan.
 *
 * Next 16 passes `retry`, not `reset` (node_modules/next/dist/docs, error.md).
 */
export default function RouteError({ error, retry, scope, homeHref = '/', homeLabelKey = 'common.errorBoundary.home' }) {
  const t = useT();
  const online = useOnline();

  useEffect(() => {
    console.error(`[${scope}] page render failed`, error);
  }, [error, scope]);

  const Icon = online ? AlertTriangle : WifiOff;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <span className={`flex h-14 w-14 items-center justify-center rounded-full ${online ? 'bg-danger-tint text-danger' : 'bg-blue-tint text-blue-deep'}`}>
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
      </span>
      <div>
        <h1 className="u-title-section text-ink">
          {online ? t('common.errorBoundary.title') : t('common.errorBoundary.offlineTitle')}
        </h1>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-70">
          {online ? t('common.errorBoundary.body') : t('common.errorBoundary.offlineBody')}
        </p>
        {online && error?.digest ? (
          <p className="u-tabular mt-2 text-[0.75rem] text-ink-35">
            {t('common.errorBoundary.reference', { digest: error.digest })}
          </p>
        ) : null}
      </div>
      <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
        <button
          type="button"
          onClick={() => retry?.()}
          className="u-press u-btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-blue px-6 text-[0.9375rem] font-semibold text-white"
        >
          <RotateCw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('common.errorBoundary.retry')}
        </button>
        <Link
          href={homeHref}
          className="u-press inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-surface px-6 text-[0.9375rem] font-semibold text-ink hover:bg-canvas-alt"
        >
          {t(homeLabelKey)}
        </Link>
      </div>
    </div>
  );
}
