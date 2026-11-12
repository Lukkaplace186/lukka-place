'use client';

import Link from '@/components/LocaleLink';
import SafeImage from '@/components/SafeImage';
import FavoriteButton from '@/components/FavoriteButton';
import Price from '@/components/Price';
import AppCardBadges from './AppCardBadges';
import AppVerifiedMark from './AppVerifiedMark';
import { useT } from '@/lib/i18n/client';
import { listingPath } from '@/lib/listingSlug';
import { feedLocationLine, listingImages, specItems, typeLabel } from '@/lib/listingView';

/**
 * A listing in the app home's photo rail: the listing's own first photo,
 * large, with nothing drawn around it, then the price, the place and what it
 * is on the page ground. Same facts and helpers as AppListingCard
 * (lib/listingView.js): a missing fact is left out, never filled.
 */
export default function AppRailCard({ listing, priority = false }) {
  const t = useT();
  const images = listingImages(listing);
  const where = feedLocationLine(listing);
  const type = typeLabel(listing, t);
  const specs = specItems(listing, t).map((s) => `${s.value} ${s.label}`);
  const facts = [type, ...specs].filter(Boolean).join(' · ');

  return (
    <article className="w-[78vw] max-w-[20rem] flex-none snap-start">
      <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-canvas-deep shadow-[var(--shadow-card)]">
        <Link href={listingPath(listing)} aria-label={listing.title || where || ''} className="absolute inset-0">
          <SafeImage
            src={images[0]}
            alt=""
            fill
            sizes="(max-width: 640px) 78vw, 320px"
            priority={priority}
            className="object-cover"
          />
        </Link>
        <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
          <AppCardBadges listing={listing} />
        </div>
        <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} className="absolute right-2.5 top-2.5" />
        <AppVerifiedMark listing={listing} className="absolute bottom-2.5 left-2.5" />
      </div>
      <Link href={listingPath(listing)} className="block pt-2.5">
        <div className="u-price u-tabular text-ink">
          <Price
            amount={listing.price}
            purpose={listing.purpose}
            pricePeriod={listing.price_period}
            showSubtext
            subtextClassName="ml-2 inline-block align-middle text-[0.8125rem] font-normal text-ink-45"
          />
        </div>
        {where ? <p className="truncate text-[0.9375rem] font-semibold text-ink">{where}</p> : null}
        {facts ? <p className="mt-0.5 truncate text-[0.8125rem] text-ink-45">{facts}</p> : null}
      </Link>
    </article>
  );
}
