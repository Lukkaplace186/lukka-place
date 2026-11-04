import { getListingsByIds, getSitemapListings } from '@/lib/listings';
import { metaFeedCsv, metaFeedItem } from '@/lib/metaHomeListingsFeed';

/**
 * Meta home listings catalogue feed (lib/metaHomeListingsFeed.js). Public on
 * purpose: Commerce Manager fetches it by URL, and everything in it is
 * already on the public listing pages (read through the same
 * `status = 1 AND approve_status = 1` gate, by getSitemapListings and
 * getListingsByIds). Set it up in Commerce Manager → Catalogue → Data
 * sources → Scheduled feed: https://lukkaplace.com/feeds/meta-home-listings.csv
 */

export const dynamic = 'force-dynamic';

const CHUNK = 200;

export async function GET() {
  try {
    const ids = (await getSitemapListings()).map((row) => row.id);
    const items = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const rows = await getListingsByIds(ids.slice(i, i + CHUNK));
      for (const row of rows) {
        const item = metaFeedItem(row);
        if (item) items.push(item);
      }
    }
    console.log(`[meta-feed] ${items.length} of ${ids.length} public listings in the feed`);
    return new Response(metaFeedCsv(items), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        // Meta fetches at most hourly; a CDN or browser may keep it 30 minutes.
        'Cache-Control': 'public, max-age=1800',
      },
    });
  } catch (err) {
    console.error(`[meta-feed] failed: ${err.message}`);
    // A 503, never an empty 200: Meta would read an empty feed as "every
    // listing is gone" and remove them from the catalogue.
    return new Response('Feed temporarily unavailable', { status: 503, headers: { 'Retry-After': '600' } });
  }
}
