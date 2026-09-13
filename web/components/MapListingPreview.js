'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Camera, X } from 'lucide-react';
import CardImageCarousel from './CardImageCarousel';
import FavoriteButton from './FavoriteButton';
import Price from './Price';
import { SPEC_ICONS } from './SpecIcons';
import { listingImages, specItems, typeLabel } from '@/lib/listingView';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useMotionSafe } from '@/lib/useMotionSafe';
import { useT } from '@/lib/i18n/client';

/**
 * The preview card a price pin opens — Rightmove's map card: an edge-to-edge
 * photo taking most of the card, and a two-line tray under it (price; type
 * and specs). Anchored to the bottom of the map, over it.
 *
 * It replaced a Google InfoWindow, and the InfoWindow is the reason it is a
 * React component at all. An InfoWindow takes an HTML STRING, which is
 * outside React's tree: it could not use SafeImage, <Price>, <Link> or
 * useT(), and the "Voir les détails" label was a `{t(...)}` typed inside a
 * template literal — so production printed the JSX source as the link text.
 * Rendered here, as a sibling of the map element (Google owns that subtree
 * and repaints it freely — the same reason BuildingUnitsDrawer lives beside
 * it), every one of those is the real component again, and the price follows
 * CurrencyToggle live.
 *
 * **What the tray leaves out, on purpose.** No address line: the pin the
 * visitor just tapped already says where it is, and the line cost the photo
 * its height. No agency mark: it is on the listing card and the detail page,
 * and the map card is for deciding whether to look closer. And no filler for
 * a missing spec — a listing with no recorded bathroom count shows no
 * bathroom cell, never a "0" (see web/CLAUDE.md, no fabricated data).
 *
 * Navigation: the photo and the tray are <Link>s to the listing. The heart
 * and the close button float over the photo but are NOT inside its link —
 * a button nested in an anchor is invalid HTML — so they sit in their own
 * overlay above it. CardImageCarousel's arrows and dots stop propagation, and
 * a swipe on the strip never produces a click, so browsing photos cannot
 * navigate away by accident.
 *
 * Media badge: photos only. There is no video, floor-plan or virtual-tour
 * column on `properties`, so the 🎥 / 📐 indicators the Rightmove reference
 * shows have nothing behind them and are not rendered.
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
      // cover most of it. A flex column capped at the map's own height, so
      // on a short map (landscape phone, browser chrome showing) the PHOTO
      // is what gives way — the price, specs and button never do.
      className="absolute inset-x-3 bottom-3 z-30 mx-auto flex max-h-[calc(100%-1.5rem)] max-w-md flex-col sm:bottom-5 sm:max-h-[calc(100%-2.5rem)]"
    >
      <div className="u-lift-lg flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
        {/* Edge to edge, ~70% of the card. An explicit height, not an
            aspect ratio: with `aspect-[16/9] max-h-*`, iOS Safari resolved
            the carousel's `h-full` against the UNCLAMPED ratio height and the
            photo painted over the price (real iPhone report, 2026-09-13).
            The link is `absolute inset-0` so nothing inside depends on a
            percentage height at all, and `overflow-hidden` clips anything
            that still disagrees. `shrink` + `min-h-24` is the short-map give
            described on the wrapper above. */}
        <div className="relative h-48 min-h-24 w-full shrink overflow-hidden bg-canvas-deep sm:h-56">
          <Link href={href} className="absolute inset-0 block">
            {images.length > 0 ? (
              <CardImageCarousel
                images={images}
                alt={listing.title || ''}
                sizes="(min-width: 640px) 28rem, 100vw"
                onIndexChange={setActiveIndex}
              />
            ) : null}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: 'var(--scrim-image)' }} />
          </Link>

          {images.length > 0 ? (
            <span className="u-glass-royal u-tabular pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold shadow-sm">
              <Camera strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
              {activeIndex + 1}/{images.length}
            </span>
          ) : null}

          {/* Same frosted glass-white circle FavoriteButton draws, so the
              two read as one control group. */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <FavoriteButton listingId={listing.id} price={listing.price} commune={listing.commune} />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('listings.map.closePreview')}
              className="u-press u-glass-white flex h-10 w-10 items-center justify-center rounded-full text-ink shadow-sm transition-colors hover:bg-white"
            >
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-1.5 px-3 py-2.5">
          {/* Line 1 — the price, with the converted FC figure muted inline.
              `truncate` keeps a long rent + FC pair on one line rather than
              letting it push the card taller. */}
          <Link href={href} className="u-tabular block truncate text-xl font-semibold leading-tight text-ink">
            <Price
              amount={listing.price}
              purpose={listing.purpose}
              pricePeriod={listing.price_period}
              currency={listing.currency}
              priceOriginal={listing.price_original}
              showSubtext
              subtextClassName="ml-2 align-middle text-[0.75rem] font-normal leading-normal text-ink-45"
            />
          </Link>

          {/* Line 2 — type | 🛏 n | 🛁 n, hairline-divided, with the detail
              button on the right. Only real values: each cell exists only
              when specItems() found the column populated. */}
          <div className="flex items-center justify-between gap-3">
            <Link href={href} className="u-micro flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-ink-70">
              {type ? <span className="truncate">{type}</span> : null}
              {specs.map((spec, i) => {
                const Icon = SPEC_ICONS[spec.key];
                return (
                  <Fragment key={spec.key}>
                    {type || i > 0 ? <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-line" /> : null}
                    <span className="inline-flex shrink-0 items-center gap-1">
                      {Icon ? <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-ink-45" aria-hidden="true" /> : null}
                      <span className="u-tabular font-semibold text-ink">{spec.value}</span>
                      {/* The icon carries the meaning visually; a screen
                          reader gets the word ("ch", "sdb"). The label stays
                          visible where there is no icon to stand in for it
                          (door count — SpecIcons has none) and for m²,
                          since a bare number reads as nothing. */}
                      {spec.key === 'area'
                        ? <span>m²</span>
                        : <span className={Icon ? 'sr-only' : undefined}>{spec.label}</span>}
                    </span>
                  </Fragment>
                );
              })}
            </Link>
            <Link
              href={href}
              className="u-press inline-flex shrink-0 items-center rounded-full bg-blue px-3 py-1.5 text-[0.75rem] font-semibold text-white transition-colors hover:bg-blue-deep"
            >
              {t('listings.map.viewDetails')}
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
