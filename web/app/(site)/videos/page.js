import { notFound } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { getVideoListings } from '@/lib/browseFeatures';
import { listingVideos } from '@/lib/listingVideos';
import { formatPrice } from '@/lib/format';
import { feedLocationLine } from '@/lib/listingView';
import VideoFeed from '@/components/VideoFeed';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t('home.videos.title')} — Lukka Place`, alternates: { canonical: '/videos' } };
}

/**
 * Listing videos, one per screen, swiped up (growth plan item 30). The videos
 * agents already send on WhatsApp (properties.videos); the page exists only
 * from MIN_VIDEO_LISTINGS listings with a video (a 404 below that).
 */
export default async function VideosPage() {
  const listings = await getVideoListings({ limit: 30 });
  if (!listings.length) notFound();
  const t = await getT();
  const items = listings
    .map((listing) => {
      const video = listingVideos(listing)[0];
      if (!video) return null;
      return {
        id: listing.id,
        src: video.url,
        poster: video.poster || null,
        title: listing.title || null,
        price: formatPrice(listing.price, listing.purpose, listing.price_period),
        place: feedLocationLine(listing),
      };
    })
    .filter(Boolean);
  if (!items.length) notFound();
  return <VideoFeed items={items} labels={{ title: t('home.videos.title'), open: t('home.videos.open'), sound: t('home.videos.sound') }} />;
}
