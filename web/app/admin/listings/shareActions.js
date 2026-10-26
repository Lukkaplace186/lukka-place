'use server';

import { requireAdmin } from '@/lib/adminSession';
import { getFlyerListingForTeam } from '@/lib/listingFlyer';
import { buildShareKit } from '@/lib/marketing/shareKit';

/**
 * The share kit for Lukka Place's own social posts — the "Carte réseaux
 * sociaux" on /admin/listings/[id] (2026-10-26). The same kit an agent gets
 * from Mes biens (lib/marketing/shareKit.js), for any agent's listing, with
 * the feed caption's link tagged as the company's (TEAM_SOCIAL_SOURCE).
 *
 * Read-only: drawing a card changes nothing and messages nobody, so it is
 * open to every console role (`listings.view`) and is not audited. Nothing is
 * written to listing_shares either — that table records what AGENTS did with
 * their own listings, and a company post is not one.
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
