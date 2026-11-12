'use client';

import { Sparkles, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cardPromoBadge } from '@/lib/listingView';
import { useT } from '@/lib/i18n/client';

// The same facts the website's CardBadges shows (listing status, then at
// most one promo from cardPromoBadge: a recorded price cut or "Nouveau"),
// drawn with the app's Badge: under offer amber, let/sold grey, a cut green,
// new royal. A shadow lifts each off the photo behind it.
const STATUS = {
  under_offer: { key: 'listings.badges.underOffer', variant: 'warning' },
  closed: { key: 'listings.badges.closed', variant: 'secondary' },
};

export default function AppCardBadges({ listing }) {
  const t = useT();
  const status = STATUS[listing.listing_status];
  const promo = cardPromoBadge(listing);
  return (
    <>
      {status ? <Badge variant={status.variant} className="shadow-sm">{t(status.key)}</Badge> : null}
      {promo?.kind === 'priceDrop' ? (
        <Badge variant="success" className="shadow-sm">
          <TrendingDown aria-hidden="true" />
          {t('listings.badges.priceDrop', { percent: promo.percent })}
        </Badge>
      ) : null}
      {promo?.kind === 'fresh' ? (
        <Badge className="shadow-sm">
          <Sparkles aria-hidden="true" />
          {t('listings.badges.fresh')}
        </Badge>
      ) : null}
    </>
  );
}
