'use server';

import { getCurrentAgentId } from '@/lib/agentSession';
import { agentBrandFields, getFlyerListing, frenchTypeText, PLATFORM_MARK_PATH } from '@/lib/listingFlyer';
import { SHARE_SOURCES, agentContactPhone, buildListingSocialCopy, listingPublicUrl, shareBlocker } from '@/lib/listingShareCopy';
import { buildFlyerPack, optimisableImageSrc, optimisedImageUrl, LOGO_WIDTH } from '@/lib/marketing/sharePackData';
import { buildMandateCaption, buildMandateReport, reportWindow } from '@/lib/marketing/mandateReportCopy';
import { getMandateCounts } from '@/lib/marketing/mandateReport';
import { listingImages } from '@/lib/listingView';

function supabaseHost() {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    return null;
  }
}

async function ownedListing(listingId) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { error: { ok: false, reason: 'auth' } };
  const listing = await getFlyerListing(agentId, Number.parseInt(listingId, 10));
  if (!listing) return { error: { ok: false, reason: 'not_found' } };
  return { listing };
}

/**
 * Everything the "Visuel & partage" dialog needs for one of the agent's own
 * listings, in one round trip: whether it can be advertised, the captions,
 * and the SHARE PACK the browser draws every image format from
 * (lib/marketing/sharePackData.js). The dialog keeps the pack in IndexedDB
 * (lib/sharePack.js), so the agent can make the graphic again with no
 * connection.
 *
 * Built server-side so the French dictionary (for the parcelle sub-type label)
 * never ships to the browser just to write one caption.
 *
 * One caption per way out of the kit (`copies.image` / `.whatsapp` / `.copy`),
 * identical except for the link's utm_source — see SHARE_SOURCES.
 *
 * @returns {Promise<{ok: true, shareable: boolean, blocker: string|null, url: string, copy: string,
 *                    copies: Record<keyof SHARE_SOURCES, string>, pack: object}
 *                  |{ok: false, reason: 'auth'|'not_found'}>}
 */
export async function getSharePackAction(listingId) {
  const { listing, error } = await ownedListing(listingId);
  if (error) return error;

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
    pack: buildFlyerPack(listing, {
      typeText,
      brand: agentBrandFields(listing),
      supabaseHost: supabaseHost(),
      markPath: PLATFORM_MARK_PATH,
      fetchedAt: new Date().toISOString(),
    }),
  };
}

/**
 * The landlord report ("Rapport de diffusion") for one of the agent's own
 * listings: this week's and last week's counts, the card's fields and the
 * caption. Live numbers only — there is no offline copy of a report, since a
 * report that is a day old is a report with the wrong week on it.
 *
 * Allowed for a listing in any state: an owner whose property is pending or
 * under offer still wants to know what happened, and the status line says
 * where it stands.
 *
 * @returns {Promise<{ok: true, report: object, caption: string, photo: string|null, mark: string}
 *                  |{ok: false, reason: 'auth'|'not_found'|'failed'}>}
 */
export async function getMandateReportAction(listingId) {
  const { listing, error } = await ownedListing(listingId);
  if (error) return error;

  try {
    const window = reportWindow(new Date());
    const counts = await getMandateCounts(listing.id, window);
    const report = buildMandateReport(listing, counts, {
      typeText: frenchTypeText(listing),
      brand: agentBrandFields(listing),
      window,
    });
    const cover = listingImages(listing).find((src) => optimisableImageSrc(src, { supabaseHost: supabaseHost() }));
    return {
      ok: true,
      report,
      caption: buildMandateCaption(listing, report, counts),
      // Drawn at 212px on the card; the 384px variant is plenty.
      photo: cover ? optimisedImageUrl(cover, LOGO_WIDTH) : null,
      mark: PLATFORM_MARK_PATH,
    };
  } catch (err) {
    console.error(`[mandate-report] listing ${listing.id}: ${err.message}`);
    return { ok: false, reason: 'failed' };
  }
}
