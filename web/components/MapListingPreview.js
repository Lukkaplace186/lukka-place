'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Camera, X } from 'lucide-react';
import CardImageCarousel from './CardImageCarousel';
import FavoriteButton from './FavoriteButton';
import AgencyLogo from './AgencyLogo';
import Price from './Price';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { listingImages, specItems, typeLabel, feedLocationLine } from '@/lib/listingView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useMotionSafe } from '@/lib/useMotionSafe';
import { useT } from '@/lib/i18n/client';

/**
 * The preview card a price pin opens — Rightmove's map pattern: a card
 * anchored to the bottom of the map, over it, with a swipeable photo strip.
 *
 * It replaced a Google InfoWindow, and the InfoWindow is the reason it is a
 * React component at all. An InfoWindow takes an HTML STRING, which is
 * outside React's tree: it could not use SafeImage, <Price>, <Link> or
 * useT(), and the "Voir les détails" label was a `{t(...)}` typed inside a
 * template literal — so production printed the JSX source as the link text.
 * Rendered here, as a sibling of the map element (Google owns that subtree
 * and repaints it freely — the same reason BuildingUnitsDrawer lives beside
 * it), every one of those is the real component again, and the price follows
 * CurrencyToggle live instead of freezing at whatever it was when the pin was
 * clicked.
 *
 * Navigation: the photo and the text body are each a <Link> to the listing.
 * They are two links rather than one wrapping the whole card because the
 * close button must sit outside any anchor. CardImageCarousel's arrows and
 * dots already stop propagation for exactly this (it lives inside
 * PropertyCard's Link too), and a swipe on the strip never produces a click,
 * so browsing photos cannot navigate away by accident.
 *
 * Media badge: photos only. There is no video, floor-plan or virtual-tour
 * column on `properties`, so the 🎥 / 📐 indicators the Rightmove reference
 * shows have nothing behind them and are not rendered — a floor-plan icon on
 * a listing with no floor plan is a fabricated claim.
 */
export default function MapListingPreview({ listing, onClose }) {
  const t = useT();
  const safe = useMotionSafe();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!listing) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listing, onClose]);

  if (!listing) return null;

  const href = `/listings/${encodeURIComponent(listing.id)}`;
  const images = listingImages(listing);
  const type = typeLabel(listing, t);
  const specs = specItems(listing, t);
  const where = feedLocationLine(listing);
  const hasAgency = Boolean(displayableAgencyName(listing.agency_name) || listing.agency_logo_url);
  const specLine = [type, ...specs.map((spec) => `${spec.value} ${spec.label}`)].filter(Boolean).join(' · ');

  return (
    // The caller keys this component by listing id, so tapping a second pin
    // remounts it: the entrance replays and the photo index starts at 1
    // rather than opening listing B on listing A's photo.
    <motion.div
      initial={safe ? { opacity: 0, y: 24 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      role="dialog"
      aria-label={listing.title || t('listings.map.viewDetails')}
      // Bottom-anchored over the map. Centred with a ceiling on desktop,
      // where the map pane is half the screen and a full-width card would
      // cover most of it.
      className="absolute inset-x-3 bottom-3 z-30 mx-auto max-w-md sm:bottom-5"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('listings.map.closePreview')}
        className="u-press u-lift absolute -top-3 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink"
      >
        <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </button>

      <div className="u-lift-lg overflow-hidden rounded-2xl border border-line bg-surface">
        <Link href={href} className="relative block aspect-[16/9] max-h-[11.5rem] w-full bg-canvas-deep sm:max-h-[13rem]">
          {images.length > 0 ? (
            <CardImageCarousel
              images={images}
              alt={listing.title || ''}
              sizes="(min-width: 640px) 28rem, 100vw"
              onIndexChange={setActiveIndex}
            />
          ) : null}

          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'var(--scrim-image)' }} />

          {images.length > 0 ? (
            <span className="u-glass-royal u-tabular pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold shadow-sm">
              <Camera strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
              {activeIndex + 1}/{images.length}
            </span>
          ) : null}

          <div className="absolute right-3 top-3 z-10">
            <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} />
          </div>
        </Link>

        <div className="flex flex-col gap-1 px-4 pb-3 pt-3">
          <Link href={href} className="flex min-w-0 flex-col gap-1">
            <span className="u-tabular text-xl font-semibold leading-tight text-ink">
              <Price
                amount={listing.price}
                purpose={listing.purpose}
                pricePeriod={listing.price_period}
                currency={listing.currency}
                priceOriginal={listing.price_original}
                showSubtext
                subtextClassName="ml-2 inline-block align-middle text-[0.75rem] font-normal leading-normal text-ink-45"
              />
            </span>
            {specLine ? <span className="u-micro truncate text-ink-70">{specLine}</span> : null}
            {where ? <span className="u-micro truncate text-ink-45">{where}</span> : null}
          </Link>

          <div className="mt-1.5 flex items-center justify-between gap-3 border-t border-line pt-2.5">
            {hasAgency ? <AgencyLogo logoUrl={listing.agency_logo_url} name={listing.agency_name} /> : <span />}
            <Link
              href={href}
              className="u-press inline-flex shrink-0 items-center rounded-full bg-blue px-4 py-2 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-blue-deep"
            >
              {t('listings.map.viewDetails')}
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
