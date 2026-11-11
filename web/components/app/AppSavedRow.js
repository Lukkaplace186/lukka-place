'use client';

import Link from '@/components/LocaleLink';
import SafeImage from '@/components/SafeImage';
import FavoriteButton from '@/components/FavoriteButton';
import Price from '@/components/Price';
import { useT } from '@/lib/i18n/client';
import { listingPath } from '@/lib/listingSlug';
import { cardPromoBadge, feedLocationLine, listingImages, specItems, typeLabel } from '@/lib/listingView';

/**
 * A saved listing as one compact row (the app design's "Saved homes"): photo
 * on the left, price, place and what it is, the heart to unsave, and the
 * price cut when there really is one (cardPromoBadge: a recorded drop).
 */
export default function AppSavedRow({ listing }) {
  const t = useT();
  const image = listingImages(listing)[0];
  const where = feedLocationLine(listing);
  const facts = [typeLabel(listing, t), ...specItems(listing, t).map((s) => `${s.value} ${s.label}`)].filter(Boolean).join(' · ');
  const promo = cardPromoBadge(listing);

  return (
    <article className="relative flex overflow-hidden rounded-2xl border border-line bg-surface">
      <Link href={listingPath(listing)} className="relative block w-28 flex-none self-stretch bg-canvas-alt" aria-hidden="true" tabIndex={-1}>
        <SafeImage src={image} alt="" fill sizes="112px" className="object-cover" />
      </Link>
      <Link href={listingPath(listing)} className="min-w-0 flex-1 py-3 pl-3.5 pr-12">
        <div className="u-tabular text-[1.125rem] font-extrabold leading-tight text-ink">
          <Price amount={listing.price} purpose={listing.purpose} pricePeriod={listing.price_period} periodClassName="ml-1 text-[0.8125rem] font-normal text-ink" />
        </div>
        {where ? <p className="mt-1 truncate text-[0.875rem] font-semibold text-ink">{where}</p> : null}
        {facts ? <p className="mt-0.5 truncate text-[0.8125rem] text-ink-45">{facts}</p> : null}
        {promo?.kind === 'priceDrop' ? (
          <span className="mt-2 inline-block rounded-md bg-green-tint px-2 py-0.5 text-[0.75rem] font-semibold text-green-ink">
            {t('listings.badges.priceDrop', { percent: promo.percent })}
          </span>
        ) : null}
      </Link>
      <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} className="absolute right-2 top-2" />
    </article>
  );
}
