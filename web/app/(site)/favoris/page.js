import FavorisView from './FavorisView';
import { getListingsByIds } from '@/lib/listings';
import { parseShareIds, sharedSelectionMetadata } from '@/lib/sharedSelectionMeta';
import { getT } from '@/lib/i18n/server';
import AppSavedScreen from '@/components/app/AppSavedScreen';
import { isAppRequest } from '@/lib/appMode';
import { getCurrentCustomerId, listSavedSearches } from '@/lib/customers';

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

/**
 * The signed-in customer's saved searches with their id and alert frequency
 * (the app's alert switches need both); null when signed out or unreadable,
 * and the screen then shows this phone's own saved searches.
 */
async function accountSearches() {
  try {
    const id = await getCurrentCustomerId();
    if (!id) return null;
    const rows = await listSavedSearches(id);
    return rows.map((row) => ({ id: row.id, label: row.label, query: row.query, alert_frequency: row.alert_frequency }));
  } catch (error) {
    console.error('[favoris] saved searches unavailable', error.message);
    return null;
  }
}

export default async function FavorisPage({ searchParams }) {
  // Inside the store app: the app design's Saved tab — except for a shared
  // selection link (?ids=), which keeps the page made for it.
  const shared = parseShareIds((await searchParams)?.ids).length > 0;
  if (!shared && (await isAppRequest())) return <AppSavedScreen accountSearches={await accountSearches()} />;
  return <FavorisView />;
}
