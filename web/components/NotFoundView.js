import Link from 'next/link';
import { SearchX, HomeIcon } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The 404 body, in French, with a way forward. Before it existed every dead
 * link — most often a listing shared on WhatsApp and since let or withdrawn —
 * landed on Next's default English "This page could not be found." with
 * nothing to tap.
 *
 * `variant="listing"` is the case that actually happens: say plainly that the
 * property is gone (not that the visitor typed something wrong) and put
 * current listings (`children`) straight underneath.
 */
export default async function NotFoundView({ variant = 'page', children = null }) {
  const t = await getT();
  const key = variant === 'listing' ? 'listing' : 'page';

  return (
    <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
          <SearchX strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="u-title-section text-ink">{t(`common.notFound.${key}.title`)}</h1>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-70">{t(`common.notFound.${key}.body`)}</p>
        </div>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Link
            href="/listings"
            className="u-press u-btn-primary inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-blue px-6 text-[0.9375rem] font-semibold text-white"
          >
            {t('common.notFound.browse')}
          </Link>
          <Link
            href="/"
            className="u-press inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 text-[0.9375rem] font-semibold text-ink hover:bg-canvas-alt"
          >
            <HomeIcon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('common.errorBoundary.home')}
          </Link>
        </div>
      </div>
      {children ? <div className="mt-12">{children}</div> : null}
    </div>
  );
}
