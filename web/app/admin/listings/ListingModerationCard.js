import SafeImage from '@/components/SafeImage';
import { Button } from '@/components/ui/button';
import { listingImages, feedLocationLine } from '@/lib/listingView';
import { formatPrice } from '@/lib/format';
import { approveListingAction, rejectListingAction } from './actions';

/**
 * Admin-only card — deliberately not a reuse of ListingCard/ListingCardVertical
 * (see web/CLAUDE.md: those are public-facing, client components, hard-linked
 * to /listings/[id], and hard-render FavoriteButton/WhatsAppCTA/CallCTA with
 * no way to omit them). A fourth, admin-scoped layout, same principle as the
 * three public ones existing on purpose.
 */
export default function ListingModerationCard({ listing, status }) {
  const image = listingImages(listing)[0];
  const boundApprove = approveListingAction.bind(null, listing.id);
  const boundReject = rejectListingAction.bind(null, listing.id);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="relative aspect-[4/3] w-full bg-canvas-alt">
        <SafeImage src={image} alt={listing.title} fill sizes="(min-width: 640px) 320px, 100vw" className="object-cover" />
      </div>

      <div className="space-y-1.5 p-3">
        <p className="line-clamp-1 text-sm font-semibold text-ink">{listing.title}</p>
        <p className="text-xs text-ink-45">{feedLocationLine(listing) || '—'}</p>
        <p className="u-tabular text-sm font-semibold text-ink">
          {formatPrice(listing.price, listing.purpose, listing.price_period)}
        </p>

        <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1 text-xs text-ink-45">
          <dt className="font-medium text-ink-70">Réf.</dt>
          <dd className="u-ref">{listing.reference || '—'}</dd>
          <dt className="font-medium text-ink-70">Agence</dt>
          <dd>{listing.agency_name || '—'}</dd>
          <dt className="font-medium text-ink-70">Téléphone</dt>
          <dd>{listing.agent_phone || '—'}</dd>
        </dl>

        <div className="flex items-center gap-2 pt-2">
          {status !== 'approved' && (
            <form action={boundApprove}>
              <Button type="submit" size="sm">
                Approuver
              </Button>
            </form>
          )}
          {status !== 'rejected' && (
            <form action={boundReject}>
              <Button type="submit" size="sm" variant="destructive">
                Rejeter
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
