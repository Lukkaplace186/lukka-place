import 'server-only';
import { agentBrandFields, frenchTypeText, PLATFORM_MARK_PATH, PLATFORM_MARK_LIGHT_PATH, PLATFORM_WORDMARK_PATH } from '../listingFlyer';
import { SHARE_SOURCES, TEAM_SOCIAL_SOURCE, agentContactPhone, buildListingSocialCopy, listingPublicUrl, shareBlocker } from '../listingShareCopy';
import { buildFlyerPack } from './sharePackData';

function supabaseHost() {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    return null;
  }
}

/**
 * The share kit for one listing row (lib/listingFlyer.js FLYER_SELECT):
 * whether it can be advertised, the captions, and the SHARE PACK the browser
 * draws every image format from (lib/marketing/sharePackData.js).
 *
 * Two audiences, one kit (2026-10-26):
 * - 'agent' — the listing's own agent, from Mes biens
 *   (app/compte/agent/shareActions.js getSharePackAction).
 * - 'team' — Lukka Place posting on its own pages, from /admin/listings/[id]
 *   (app/admin/listings/shareActions.js). Same pack and captions; the feed
 *   caption's link carries TEAM_SOCIAL_SOURCE so the company's own posts are
 *   told apart from the agents' in the traffic-source breakdown.
 *
 * One caption per way out of the kit (`copies.image` / `.whatsapp` / `.copy` /
 * `.social`), identical except for the link's utm_source — see SHARE_SOURCES —
 * and for `.social`, the feed card's caption, written for Instagram and
 * Facebook: no WhatsApp *bold*, no agent number (it sends people back to the
 * listing on lukkaplace.com), hashtags at the end.
 *
 * @param {object} listing
 * @param {{audience?: 'agent'|'team'}} [options]
 */
export function buildShareKit(listing, { audience = 'agent' } = {}) {
  const blocker = shareBlocker(listing);
  const typeText = frenchTypeText(listing);
  const contactPhone = agentContactPhone(listing);
  const brand = agentBrandFields(listing);
  const sourceFor = (channel, source) => (channel === 'social' && audience === 'team' ? TEAM_SOCIAL_SOURCE : source);
  const copies = Object.fromEntries(
    Object.entries(SHARE_SOURCES).map(([channel, source]) => [
      channel,
      buildListingSocialCopy(listing, {
        typeText,
        contactPhone,
        contactName: brand.name,
        url: listingPublicUrl(listing.id, { source: sourceFor(channel, source) }),
        style: channel === 'social' ? 'social' : 'whatsapp',
      }),
    ]),
  );
  return {
    ok: true,
    audience,
    shareable: !blocker,
    blocker,
    url: listingPublicUrl(listing.id),
    copy: copies.copy,
    copies,
    pack: buildFlyerPack(listing, {
      typeText,
      brand,
      supabaseHost: supabaseHost(),
      markPath: PLATFORM_MARK_PATH,
      markLightPath: PLATFORM_MARK_LIGHT_PATH,
      wordmarkPath: PLATFORM_WORDMARK_PATH,
      fetchedAt: new Date().toISOString(),
    }),
  };
}
