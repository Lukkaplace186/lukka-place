'use server';

import { getCurrentAgentId } from '@/lib/agentSession';
import { agentBrandFields, getFlyerListing, frenchTypeText, PLATFORM_MARK_PATH } from '@/lib/listingFlyer';
import { SHARE_SOURCES, agentContactPhone, buildListingSocialCopy, listingPublicUrl, shareBlocker } from '@/lib/listingShareCopy';
import { buildFlyerPack, optimisableImageSrc, optimisedImageUrl, LOGO_WIDTH } from '@/lib/marketing/sharePackData';
import { buildMandateCaption, buildMandateReport, reportWindow } from '@/lib/marketing/mandateReportCopy';
import { getMandateCounts } from '@/lib/marketing/mandateReport';
import { listingImages } from '@/lib/listingView';
import { getListingShareCount, recordListingShares } from '@/lib/listingShares';
import { MAX_IDS_PER_RECORD, normaliseShareRecord } from '@/lib/listingShareRules';

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
  return buildShareKit(listing);
}

function buildShareKit(listing) {
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
 * "Statut du jour" — the share kits for several of the agent's own listings
 * in ONE round trip (a phone on 3G pays per request). Each id goes through the
 * same ownership query as the single-listing kit; one that is not theirs, or
 * no longer shareable, is left out rather than failing the batch.
 *
 * @returns {Promise<{ok: true, kits: Array<object>}|{ok: false, reason: 'auth'|'invalid'}>}
 */
export async function getStatusPacksAction(listingIds) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false, reason: 'auth' };
  const ids = [...new Set((Array.isArray(listingIds) ? listingIds : []).map(Number))]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, MAX_IDS_PER_RECORD);
  if (!ids.length) return { ok: false, reason: 'invalid' };

  const kits = [];
  for (const id of ids) {
    const listing = await getFlyerListing(agentId, id);
    if (!listing) continue;
    const kit = buildShareKit(listing);
    if (kit.shareable) kits.push(kit);
  }
  return { ok: true, kits };
}

/**
 * Records that the agent shared, downloaded, copied or printed one or more of
 * their listings (lib/listingShareRules.js says what counts). The browser
 * calls this fire-and-forget AFTER the share has happened, so nothing here can
 * delay or block one; a refusal, a missing table or a dead connection simply
 * records nothing.
 *
 * The agent id comes from the session. Ownership and "is it live" are checked
 * inside the INSERT (lib/listingShares.js), and a repeated tap inside the
 * dedupe window writes nothing.
 *
 * @returns {Promise<{ok: boolean, recorded?: number}>}
 */
export async function recordListingSharesAction(input) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return { ok: false };
  const record = normaliseShareRecord(input);
  if (!record) return { ok: false };
  try {
    return { ok: true, recorded: await recordListingShares(agentId, record) };
  } catch (err) {
    console.error(`[listing-shares] record failed for agent ${agentId}: ${err.message}`);
    return { ok: false };
  }
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
    const [counts, shares] = await Promise.all([
      getMandateCounts(listing.id, window),
      // Same 7 days as the tiles. null (unknown) prints nothing.
      getListingShareCount(listing.id, { from: window.from, until: window.end }),
    ]);
    const report = buildMandateReport(listing, counts, {
      typeText: frenchTypeText(listing),
      brand: agentBrandFields(listing),
      window,
      shares,
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
