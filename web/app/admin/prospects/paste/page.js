import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * "Coller une publication" (2026-10-23) is folded into "Coller des annonces"
 * (2026-11-08, owner): one paste now reads each advert's price for the guide
 * AND its poster for the agent list (market_prospects), so this old page,
 * which kept numbers only, would have been a second list. Bookmarks land on
 * the paste box.
 */
export default function PasteFacebookPostPage() {
  redirect('/admin/market-data/marche#coller');
}
