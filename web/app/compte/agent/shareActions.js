'use server';

import { getCurrentAgentId } from '@/lib/agentSession';
import { getFlyerListing, frenchTypeText } from '@/lib/listingFlyer';
import { SHARE_SOURCES, agentContactPhone, buildListingSocialCopy, listingPublicUrl, shareBlocker } from '@/lib/listingShareCopy';

/**
 * Everything the "Visuel & partage" dialog needs for one of the agent's own
 * listings: whether it can be advertised at all, the ready-to-paste French
 * copy, and the public link. The image itself is the /visuel route.
 *
 * Built server-side so the French dictionary (for the parcelle sub-type label)
 * never ships to the browser just to write one caption.
 *
 * One caption per way out of the kit (`copies.image` / `.whatsapp` / `.copy`),
 * identical except for the link's utm_source — see SHARE_SOURCES.
 *
 * @returns {Promise<{ok: true, shareable: boolean, blocker: string|null, copy: string,
 *                    copies: Record<keyof SHARE_SOURCES, string>, url: string}
 *                  |{ok: false, reason: 'auth'|'not_found'}>}
 */
export async function getListingShareKitAction(listingId) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, reason: 'auth' };

  const listing = await getFlyerListing(agentId, Number.parseInt(listingId, 10));
  if (!listing) return { ok: false, reason: 'not_found' };

  const blocker = shareBlocker(listing);
  const typeText = frenchTypeText(listing);
  const contactPhone = agentContactPhone(listing);
  const copies = Object.fromEntries(
    Object.entries(SHARE_SOURCES).map(([channel, source]) => [
      channel,
      buildListingSocialCopy(listing, { typeText, contactPhone, url: listingPublicUrl(listing.id, { source }) }),
    ]),
  );
  return {
    ok: true,
    shareable: !blocker,
    blocker,
    url: listingPublicUrl(listing.id),
    copy: copies.copy,
    copies,
  };
}
