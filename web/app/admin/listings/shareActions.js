'use server';

import { recordAudit } from '@/lib/adminAudit';
import { requireAdmin } from '@/lib/adminSession';
import { getFlyerListingForTeam } from '@/lib/listingFlyer';
import { buildShareKit } from '@/lib/marketing/shareKit';
import { facebookDebuggerUrl, refreshFacebookPreview } from '@/lib/facebookPreview';
import { getTeamSocialPostsByListing, recordTeamSocialPost } from '@/lib/teamSocialPosts';
import { resolveTeamSocialTarget, teamSocialUrl } from '@/lib/teamSocialTargets';

/**
 * The share kit for Lukka Place's own social posts — the "Carte réseaux
 * sociaux" on /admin/listings/[id] (2026-10-26) and, since 2026-11-06, on
 * every row of /admin/listings' "Approuvées" tab. The same kit an agent gets
 * from Mes biens (lib/marketing/shareKit.js), for any agent's listing, with
 * the feed caption's link tagged as the company's (TEAM_SOCIAL_SOURCE).
 *
 * Read-only: drawing a card changes nothing and messages nobody, so it is
 * open to every console role (`listings.view`) and is not audited. Nothing is
 * written to listing_shares either — that table records what AGENTS did with
 * their own listings, and a company post is not one. Where the TEAM posted it
 * is team_social_posts (recordTeamSocialPostAction below).
 *
 * @returns {Promise<object|{ok: false, reason: 'auth'|'not_found'}>}
 */
export async function getTeamSharePackAction(listingId) {
  try {
    await requireAdmin('listings.view');
  } catch {
    return { ok: false, reason: 'auth' };
  }
  const listing = await getFlyerListingForTeam(Number.parseInt(listingId, 10));
  if (!listing) return { ok: false, reason: 'not_found' };
  return buildShareKit(listing, { audience: 'team' });
}

/**
 * Makes Facebook read the feed caption's link now, so the post shows the
 * photo card rather than a bare "lukkaplace.com" box (lib/facebookPreview.js).
 * The URL is rebuilt here from the listing, never taken from the browser, so
 * the app token is only ever spent on our own public listing links. With a
 * target (a group or page picked in the dialog), it is that place's link —
 * Facebook caches per URL, so the group's link needs its own read.
 *
 * @returns {Promise<{ok: true, url: string, debuggerUrl: string, status: string}|{ok: false, reason: string}>}
 */
export async function refreshTeamFacebookPreviewAction(listingId, targetInput = null) {
  try {
    await requireAdmin('listings.view');
  } catch {
    return { ok: false, reason: 'auth' };
  }
  const listing = await getFlyerListingForTeam(Number.parseInt(listingId, 10));
  if (!listing) return { ok: false, reason: 'not_found' };
  const kit = buildShareKit(listing, { audience: 'team' });
  if (!kit.shareable) return { ok: false, reason: 'not_shareable' };
  const target = targetInput ? resolveTeamSocialTarget(targetInput) : null;
  const url = target ? teamSocialUrl(listing.id, target) : kit.socialUrl;
  const result = await refreshFacebookPreview(url);
  return { ok: true, url, debuggerUrl: facebookDebuggerUrl(url), status: result.status };
}

/** Where the team already posted this listing, newest first; `posts: null` before the migration. */
export async function getTeamSocialPostsAction(listingId) {
  try {
    await requireAdmin('listings.view');
  } catch {
    return { ok: false, reason: 'auth' };
  }
  const id = Number.parseInt(listingId, 10);
  try {
    const map = await getTeamSocialPostsByListing([id]);
    return { ok: true, posts: map ? map.get(id) || [] : null };
  } catch (err) {
    console.error(`[team-social] reading posts of listing ${id} failed: ${err.message}`);
    return { ok: true, posts: null };
  }
}

/**
 * "Marquer comme publié": the team member says they posted this listing in
 * one place (a listed group or page, or a typed name). Live listings only; the
 * same place twice within a day answers `duplicate` with the earlier post.
 * Audited like every console write.
 *
 * @param {{listingId: number, target: {key?: string, label?: string}}} input
 */
export async function recordTeamSocialPostAction({ listingId, target: targetInput } = {}) {
  let session;
  try {
    session = await requireAdmin('listings.view');
  } catch {
    return { ok: false, reason: 'auth' };
  }
  const id = Number.parseInt(listingId, 10);
  const target = resolveTeamSocialTarget(targetInput || {});
  if (!Number.isSafeInteger(id) || id <= 0 || !target) return { ok: false, reason: 'invalid' };
  try {
    const result = await recordTeamSocialPost({ propertyId: id, target, session });
    if (result.ok) {
      await recordAudit(session, {
        action: 'listing.social_post',
        entityType: 'listing',
        entityId: id,
        details: { target: target.key },
      });
    }
    return result;
  } catch (err) {
    console.error(`[team-social] recording listing ${id} in ${target.key} failed: ${err.message}`);
    return { ok: false, reason: 'error' };
  }
}
