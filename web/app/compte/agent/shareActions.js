'use server';

import { getCurrentAgentId } from '@/lib/agentSession';
import { getFlyerListing, frenchTypeText } from '@/lib/listingFlyer';
import { buildListingSocialCopy, listingPublicUrl, shareBlocker } from '@/lib/listingShareCopy';

/**
 * Everything the "Visuel & partage" dialog needs for one of the agent's own
 * listings: whether it can be advertised at all, the ready-to-paste French
 * copy, and the public link. The image itself is the /visuel route.
 *
 * Built server-side so the French dictionary (for the parcelle sub-type label)
 * never ships to the browser just to write one caption.
 *
 * @returns {Promise<{ok: true, shareable: boolean, blocker: string|null, copy: string, url: string}
 *                  |{ok: false, reason: 'auth'|'not_found'}>}
 */
export async function getListingShareKitAction(listingId) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, reason: 'auth' };

  const listing = await getFlyerListing(agentId, Number.parseInt(listingId, 10));
  if (!listing) return { ok: false, reason: 'not_found' };

  const blocker = shareBlocker(listing);
  const url = listingPublicUrl(listing.id);
  return {
    ok: true,
    shareable: !blocker,
    blocker,
    url,
    copy: buildListingSocialCopy(listing, { typeText: frenchTypeText(listing), url }),
  };
}
