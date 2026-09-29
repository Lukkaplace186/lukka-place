import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { getMarketPosition } from '@/lib/listingPerformance';
import { formatPrice } from '@/lib/format';
import { typeLabel } from '@/lib/listingView';
import { communeHref } from '@/lib/listingSeo';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Loyer médian demandé à Limete (appartement, 2 chambres) : 1 200 $ / mois —
 * 7 annonces comparables en ligne." The public half of the market position the
 * agent sees on their listing page (lib/listingPerformance.js).
 *
 * Deliberately narrower than the agent's view:
 *  - only a like-for-like median (same type, or same type AND bedrooms) —
 *    never the whole-commune figure, which mixes studios with villas;
 *  - only at MARKET_MIN_SAMPLE (5) comparables or more, count printed beside it;
 *  - no "+8 %" against this listing: that is the agent's pricing conversation
 *    with their landlord, not a judgement to publish on their own page.
 * Nothing renders otherwise, and a failed read renders nothing.
 */
export default async function MarketMedianLine({ listing }) {
  const position = await getMarketPosition(listing).catch(() => null);
  if (!position || position.median == null || !['beds', 'type'].includes(position.scope)) return null;
  const t = await getT();
  const kind = typeLabel(listing, t);
  const vars = {
    label: t(`listings.marketMedian.${listing.purpose === 'sale' ? 'sale' : 'rent'}`),
    commune: listing.commune,
    type: kind ? kind.charAt(0).toLowerCase() + kind.slice(1) : '',
    beds: t('seo.factBeds', { count: Number(listing.beds) }),
    median: formatPrice(position.median, listing.purpose, 'mois'),
    count: position.n,
  };
  const href = communeHref(listing);
  return (
    <p className="u-micro flex items-start gap-2 text-ink-70">
      <BarChart3 size={16} strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 flex-none text-ink-45" aria-hidden="true" />
      <span>
        {t(`listings.marketMedian.${position.scope}`, vars)}
        {href ? (
          <>
            {' · '}
            <Link href={href} className="font-semibold text-blue-deep underline-offset-2 hover:underline">
              {t('listings.marketMedian.more', { commune: listing.commune })}
            </Link>
          </>
        ) : null}
      </span>
    </p>
  );
}
