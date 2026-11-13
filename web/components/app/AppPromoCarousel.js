'use client';

import Link from '@/components/IntentLink';
import { BookOpen } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';

/**
 * The app home's card slot (the owner's reference: the banner row under the
 * search on Rightmove's home, 2026-11-13). Today it carries Lukka Place's own
 * guides and news; later the same slot is meant for partner agencies.
 *
 * So it knows nothing about articles: it draws `items`
 * ({ href, title, kicker, imageUrl }) under `title`, and whoever feeds it
 * decides what they are. Changing the feed changes the slot; the layout
 * stays.
 *
 * A card shows its own picture when it has one. Without one it is a plain
 * tinted card with the title: never a stock picture standing in for it.
 */
export default function AppPromoCarousel({ title, moreHref = null, moreLabel = null, items = [] }) {
  const locale = useLocale();
  if (!items.length) return null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-4">
        <h2 className="text-[1.0625rem] font-bold text-ink">{title}</h2>
        {moreHref && moreLabel ? (
          <Link href={localizeHref(moreHref, locale)} className="u-hit relative text-[0.875rem] font-semibold text-blue-deep">
            {moreLabel}
          </Link>
        ) : null}
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={localizeHref(item.href, locale)}
            className="u-press flex w-[78vw] max-w-[20rem] flex-none snap-start flex-col overflow-hidden rounded-card bg-surface shadow-[var(--shadow-card)]"
          >
            {item.imageUrl ? (
              // The article's own cover, as stored (any https host an editor
              // used): a plain img, since next/image only serves allowed hosts.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imageUrl} alt="" loading="lazy" className="aspect-[16/9] w-full bg-canvas-deep object-cover" />
            ) : (
              <span className="flex aspect-[16/9] w-full items-center justify-center bg-blue-tint text-blue-deep" aria-hidden="true">
                <BookOpen strokeWidth={ICON_STROKE_WIDTH} className="h-8 w-8" />
              </span>
            )}
            <span className="flex flex-1 flex-col gap-1 px-3.5 pb-3.5 pt-3">
              {item.kicker ? <span className="text-[0.75rem] font-semibold text-ink-45">{item.kicker}</span> : null}
              <span className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug text-ink">{item.title}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
