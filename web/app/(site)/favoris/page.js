import FavorisView from './FavorisView';
import { getListingsByIds } from '@/lib/listings';
import { parseShareIds, sharedSelectionMetadata } from '@/lib/sharedSelectionMeta';
import { getT } from '@/lib/i18n/server';

/**
 * A server shell around the client page, for one reason: a shared
 * `/favoris?ids=` link is what "Partager ma sélection" sends over WhatsApp,
 * and WhatsApp's crawler only ever sees server-rendered <meta> tags. As a
 * pure client page this unfurled as the site's generic logo card. Without
 * `?ids=` (a visitor's own favourites) nothing changes.
 *
 * A database failure falls back to the default card rather than failing
 * the page: the preview is a courtesy, the list below is the point.
 */
export async function generateMetadata({ searchParams }) {
  const ids = parseShareIds((await searchParams)?.ids).slice(0, 50);
  if (ids.length === 0) return {};

  try {
    const [t, listings] = await Promise.all([getT(), getListingsByIds(ids)]);
    return sharedSelectionMetadata(ids, listings, t) ?? {};
  } catch (error) {
    console.error('[favoris] share preview metadata failed', error);
    return {};
  }
}

export default function FavorisPage() {
  return <FavorisView />;
}
