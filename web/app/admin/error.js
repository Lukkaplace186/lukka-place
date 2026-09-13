'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * The console's error boundary. A page that throws while rendering — the
 * engine timing out, Postgres refusing a connection, a bug — now fails INSIDE
 * the admin shell, with the sidebar still there and a retry button, instead of
 * replacing the whole window with "This page couldn't load" (which is how
 * /admin/matching failed for everyone until its translator-shadowing bug was
 * fixed).
 *
 * Pages still catch their own data errors and render an ErrorNote where one
 * source failing should not blank the rest; this is the net under that.
 */
export default function AdminError({ error, retry }) {
  const t = useT();

  useEffect(() => {
    console.error('[admin] page render failed', error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-tint">
        <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6 text-danger" />
      </span>
      <div>
        <h1 className="u-title-section text-ink">{t('admin.errorBoundary.title')}</h1>
        <p className="u-micro mt-2 text-ink-70">{t('admin.errorBoundary.body')}</p>
        {error?.digest ? (
          <p className="u-micro u-tabular mt-2 text-ink-35">{t('admin.errorBoundary.reference', { digest: error.digest })}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => retry?.()}
          className="u-press u-btn-primary inline-flex items-center gap-2 rounded-lg bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-deep"
        >
          <RotateCw strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.errorBoundary.retry')}
        </button>
        <Link
          href="/admin/dashboard"
          className="u-press inline-flex items-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-canvas-alt"
        >
          {t('admin.errorBoundary.home')}
        </Link>
      </div>
    </div>
  );
}
