import { redirect } from 'next/navigation';
import { Heart } from 'lucide-react';
import { PortalEmpty } from '@/components/ClientPortalUI';
import { getPortalCustomer } from '@/lib/customerPortal';
import { listFavoriteIds } from '@/lib/customers';
import { getListingsByIds } from '@/lib/listings';
import { removeFavoriteAction } from '../actions';
import FavoritesBoard from './FavoritesBoard';

export const metadata = {
  title: 'Mes favoris — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The saved-property board. Favourites are the account's own
 * `customer_favorites` rows; the listings themselves come back through the
 * same getListingsByIds() every other surface uses, which means the public
 * `status = 1 AND approve_status = 1` filter still applies — a favourite
 * whose listing has since been unpublished simply drops out of the board
 * rather than rendering a broken card.
 */
export default async function FavorisPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/favoris');

  const favoriteIds = await listFavoriteIds(session.customerId);
  const listings = favoriteIds.length > 0 ? await getListingsByIds(favoriteIds) : [];

  if (listings.length === 0) {
    return (
      <PortalEmpty
        icon={Heart}
        title="Aucun favori pour le moment"
        actionLabel="Parcourir les annonces"
        actionHref="/listings"
      >
        Touchez le cœur sur une annonce pour la sauvegarder. Vos favoris vous suivent sur tous vos appareils dès que
        vous êtes connecté.
      </PortalEmpty>
    );
  }

  return (
    <FavoritesBoard
      listings={listings}
      whatsappNumber={process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || null}
      removeAction={removeFavoriteAction}
    />
  );
}
