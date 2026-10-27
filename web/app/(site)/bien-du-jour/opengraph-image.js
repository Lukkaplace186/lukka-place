import ListingCardImage from '../listings/[id]/opengraph-image';
import { getListingOfTheDay } from '@/lib/browseFeatures';

/**
 * The link preview of /bien-du-jour: today's listing's own card
 * (app/(site)/listings/[id]/opengraph-image.js), drawn by the same code so
 * the two never differ. Re-read every 10 minutes: the listing changes daily.
 */
export const alt = 'Bien du jour sur Lukka Place';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/jpeg';
export const dynamic = 'force-dynamic';

export default async function Image() {
  const daily = await getListingOfTheDay();
  if (!daily) return new Response('Not found', { status: 404 });
  return ListingCardImage({ params: Promise.resolve({ id: String(daily.listing.id) }) });
}
