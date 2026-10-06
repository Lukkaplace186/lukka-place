import Link from 'next/link';
import SafeImage from '@/components/SafeImage';
import { listingImages, specItems, typeLabel, feedLocationLine } from '@/lib/listingView';
import { formatPriceParts } from '@/lib/format';

/**
 * A 250px rail card for the Espace Client (Accueil's "Nouveaux pour vos
 * alertes"): photo, price, type and place, room counts. The full PropertyCard
 * is a client component with a gallery and three CTAs, too heavy for a
 * swipeable strip of ten on a phone. No hooks — the caller passes `t`.
 */
export default function ClientMiniListingCard({ listing, t }) {
  const image = listingImages(listing)[0];
  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  const type = typeLabel(listing, t);
  const where = feedLocationLine(listing);
  const specs = specItems(listing, t).filter((s) => s.key !== 'area');
  return (
    <Link
      href={`/listings/${listing.id}`}
      className="u-press block w-[15.625rem] flex-none snap-start overflow-hidden rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]"
    >
      <span className="relative block h-32 bg-canvas-deep">
        {image ? <SafeImage src={image} alt="" fill sizes="250px" className="object-cover" /> : null}
      </span>
      <span className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5">
        <span className="u-tabular text-base font-extrabold text-ink">
          {amount}
          {period ? <span className="ml-1 text-[0.8125rem] font-medium text-ink-45">{period}</span> : null}
        </span>
        <span className="truncate text-[0.8125rem] font-semibold text-ink-70">{[type, where].filter(Boolean).join(' · ')}</span>
        {specs.length ? (
          <span className="u-tabular truncate text-[0.8125rem] text-ink-45">{specs.map((s) => `${s.value} ${s.label}`).join(' · ')}</span>
        ) : null}
      </span>
    </Link>
  );
}
