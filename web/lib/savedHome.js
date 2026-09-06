import 'server-only';
import { getPortalCustomer } from './customerPortal';
import { listFavoriteIds } from './customers';
import { getListingsByIds } from './listings';

/**
 * The homepage's personalised section, resolved as data rather than as a
 * rendered component.
 *
 * It lives here, beside the portal's other server-side reads, for one
 * reason: the homepage has to CHOOSE between this section and
 * FeaturedListings, and a choice needs an answer before it needs markup.
 * With the decision inside a component the page could only render both and
 * hide one, or call an async component as a bare function to inspect its
 * return — the section and the fallback would then be one refactor away
 * from both appearing or both vanishing.
 *
 * Returns null in the two cases that mean "there is nothing personal to
 * show": a signed-out visitor, and a signed-in one whose shelf is empty.
 * The homepage renders "Sélection de la semaine" for both. See
 * components/SavedListings.js on why the empty shelf falls back rather than
 * rendering an empty personalised section.
 *
 * Everything here is the visitor's own real data: `listFavoriteIds` reads
 * the `customer_favorites` rows they actually created, and
 * `getListingsByIds` turns those ids back into listings behind the same
 * status=1/approve_status=1 gate as every other read in this app. A listing
 * saved and since unpublished simply drops out, exactly as it does on
 * /favoris — never a dead card.
 *
 * @returns {Promise<{listings: Object[], firstName: string}|null>}
 */
export async function getSavedHomeSection() {
  const session = await getPortalCustomer();
  if (!session) return null;

  const favoriteIds = await listFavoriteIds(session.customerId);
  if (favoriteIds.length === 0) return null;

  const listings = await getListingsByIds(favoriteIds);
  if (listings.length === 0) return null;

  // Deliberately NOT the order getListingsByIds returns. That query sorts by
  // the LISTING's own created_at, which on a personal shelf is the wrong
  // recency: the visitor's mental model is "the one I saved last", not "the
  // one that was published last". listFavoriteIds already returns ids
  // newest-saved-first, so that order is reapplied over the rows.
  const byId = new Map(listings.map((listing) => [String(listing.id), listing]));
  const ordered = favoriteIds.map((id) => byId.get(String(id))).filter(Boolean);

  // First name only. `full_name` is free text the customer typed themselves,
  // so it can be empty, one word, or their whole name — an empty string here
  // means the section greets them without a name rather than rendering
  // "Bon retour,  !".
  const firstName = (session.customer.full_name || '').trim().split(/\s+/)[0] || '';

  return { listings: ordered, firstName };
}
