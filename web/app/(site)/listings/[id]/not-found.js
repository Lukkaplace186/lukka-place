import NotFoundView from '@/components/NotFoundView';
import PropertyCard from '@/components/PropertyCard';
import { getListings } from '@/lib/listings';

/**
 * A listing that is gone — let, sold, withdrawn or never approved. This is
 * the dead link people actually hit (a listing shared in a WhatsApp group
 * weeks ago), so it names what happened and puts live listings right under it.
 */
export default async function ListingNotFound() {
  const { data } = await getListings({ limit: 3 });

  return (
    <NotFoundView variant="listing">
      {data.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((listing) => (
            <PropertyCard key={listing.id} listing={listing} />
          ))}
        </div>
      ) : null}
    </NotFoundView>
  );
}
