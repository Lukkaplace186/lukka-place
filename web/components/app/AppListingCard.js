'use client';

import { useState } from 'react';
import { m } from 'motion/react';
import { Building2, Images } from 'lucide-react';
import Link from '@/components/LocaleLink';
import SafeImage from '@/components/SafeImage';
import CardImageCarousel from '@/components/CardImageCarousel';
import FavoriteButton from '@/components/FavoriteButton';
import Price from '@/components/Price';
import AppCardBadges from './AppCardBadges';
import AppVerifiedMark from './AppVerifiedMark';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { listingPath } from '@/lib/listingSlug';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { feedLocationLine, listingImages, specItems, typeLabel } from '@/lib/listingView';

/**
 * A listing in the app (the app design's results card): the listing's own
 * photos, swiped sideways, with its real badges and the heart, then price,
 * place, what it is, and who offers it. Everything comes from the row and the
 * site's own helpers (lib/listingView.js), so a missing fact is left out,
 * never filled — no room count when none was stated, no place line without a
 * place, no agency line when no real name is on file (a phone-shaped
 * "name" is refused by displayableAgencyName).
 *
 * Photos: the website's CardImageCarousel (a real snap-scroll strip; only the
 * photo on screen and its neighbour are downloaded). A swipe browses, a tap
 * opens the listing. The chip says where you are ("2/5").
 *
 * Motion: the card settles once as it scrolls into view. Transform only: it
 * is in the server HTML either way.
 */
export default function AppListingCard({ listing, priority = false }) {
  const t = useT();
  const [photo, setPhoto] = useState(0);
  const images = listingImages(listing);
  const where = feedLocationLine(listing);
  const type = typeLabel(listing, t);
  const specs = specItems(listing, t).map((s) => `${s.value} ${s.label}`);
  const facts = [type, ...specs].filter(Boolean).join(' · ');
  const agency = displayableAgencyName(listing.agency_name);

  return (
    <m.article
      initial={{ y: 24 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: '0px 0px -6% 0px' }}
      transition={{ type: 'spring', stiffness: 220, damping: 28 }}
      className="overflow-hidden rounded-card bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="relative aspect-[4/3] bg-canvas-alt">
        <Link href={listingPath(listing)} aria-label={listing.title || where || ''} className="absolute inset-0">
          {images.length > 1 ? (
            <CardImageCarousel
              images={images}
              alt=""
              sizes="(max-width: 640px) 100vw, 512px"
              priority={priority}
              onIndexChange={setPhoto}
            />
          ) : (
            <SafeImage
              src={images[0]}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, 512px"
              priority={priority}
              className="object-cover"
            />
          )}
        </Link>
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
          <AppCardBadges listing={listing} />
        </div>
        <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} className="absolute right-3 top-3 z-10" />
        <AppVerifiedMark listing={listing} className="absolute bottom-3 left-3 z-10" />
        {images.length > 1 ? (
          <span className="u-tabular pointer-events-none absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 rounded-md bg-ink/60 px-2 py-1 text-[0.75rem] font-semibold text-white">
            <Images strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-hidden="true">
              {photo + 1}/{images.length}
            </span>
            <span className="sr-only">{t('appShell.card.photos', { count: images.length })}</span>
          </span>
        ) : null}
      </div>
      <Link href={listingPath(listing)} className="block px-4 pb-4 pt-3">
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
        {agency ? (
          <p className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5 text-[0.8125rem] font-medium text-ink-70">
            <Building2 strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 flex-none text-ink-45" />
            <span className="truncate">{agency}</span>
          </p>
        ) : null}
      </Link>
    </m.article>
  );
}
