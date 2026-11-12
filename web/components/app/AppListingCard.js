'use client';

import Link from '@/components/LocaleLink';
import { Images } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import FavoriteButton from '@/components/FavoriteButton';
import Price from '@/components/Price';
import { CardBadges } from '@/components/ListingBadges';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { listingPath } from '@/lib/listingSlug';
import { feedLocationLine, listingImages, specItems, typeLabel } from '@/lib/listingView';

/**
 * A listing in the app (the app design's results card): one photo with the
 * listing's real badges and the heart, then price, place, and what it is.
 * Everything comes from the row and the site's own helpers (lib/listingView.js),
 * so a missing fact is left out, never filled — no room count when none was
 * stated, no place line without a place.
 */
export default function AppListingCard({ listing, priority = false }) {
  const t = useT();
  const images = listingImages(listing);
  const where = feedLocationLine(listing);
  const type = typeLabel(listing, t);
  const specs = specItems(listing, t).map((s) => `${s.value} ${s.label}`);
  const facts = [type, ...specs].filter(Boolean).join(' · ');

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="relative aspect-[4/3] bg-canvas-alt">
        <Link href={listingPath(listing)} aria-label={listing.title || where || ''} className="absolute inset-0">
          <SafeImage
            src={images[0]}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 512px"
            priority={priority}
            className="object-cover"
          />
        </Link>
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <CardBadges listing={listing} />
        </div>
        <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} className="absolute right-3 top-3" />
        {images.length > 1 ? (
          <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-ink/60 px-2 py-1 text-[0.75rem] font-semibold text-white">
            <Images strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true">{images.length}</span>
            <span className="sr-only">{t('appShell.card.photos', { count: images.length })}</span>
          </span>
        ) : null}
      </div>
      <Link href={listingPath(listing)} className="block px-4 pb-4 pt-3">
        <div className="u-tabular text-[1.375rem] font-extrabold leading-tight text-ink">
          <Price
            amount={listing.price}
            purpose={listing.purpose}
            pricePeriod={listing.price_period}
            showSubtext
            subtextClassName="ml-2 inline-block align-middle text-[0.8125rem] font-normal text-ink-45"
          />
        </div>
        {where ? <p className="mt-1 truncate text-[0.9375rem] font-semibold text-ink">{where}</p> : null}
        {facts ? <p className="mt-0.5 truncate text-[0.8125rem] text-ink-45">{facts}</p> : null}
      </Link>
    </article>
  );
}
