import Link from 'next/link';
import { getListingsForModeration } from '@/lib/listings';
import { getSuspendedListings } from '@/lib/adminListings';
import { LISTING_MODERATION_STATUSES, LISTING_MODERATION_STATUS_LABELS_FR } from '@/lib/adminLabels';
import ListingModerationCard from './ListingModerationCard';

export default async function AdminListingsPage({ searchParams }) {
  const params = await searchParams;
  const status = LISTING_MODERATION_STATUSES.includes(params.status) ? params.status : 'pending';

  // 'suspended' is not an approve_status value — it is status = 0 on an
  // already-approved listing, a different column entirely. See
  // LISTING_MODERATION_STATUSES' doc comment.
  const listings =
    status === 'suspended' ? await getSuspendedListings() : await getListingsForModeration(status);

  return (
    <div>
      <div className="mb-4">
        <h1 className="u-title-page text-ink">Annonces</h1>
        <p className="mt-1 text-sm text-ink-45">
          {listings.length} annonce{listings.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="mb-4 flex items-center gap-1.5">
        {LISTING_MODERATION_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/listings?status=${s}`}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              s === status
                ? 'border-blue-deep bg-blue-deep text-white'
                : 'border-line bg-white text-ink hover:bg-canvas-alt'
            }`}
          >
            {LISTING_MODERATION_STATUS_LABELS_FR[s]}
          </Link>
        ))}
      </div>

      {listings.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          Aucune annonce.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((listing) => (
            <ListingModerationCard key={listing.id} listing={listing} status={status} />
          ))}
        </div>
      )}
    </div>
  );
}
