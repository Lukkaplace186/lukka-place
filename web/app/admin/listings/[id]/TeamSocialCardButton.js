'use client';

import TeamSocialShare from '../TeamSocialShare';

/**
 * "Carte réseaux sociaux" on /admin/listings/[id] (2026-10-26): Lukka Place
 * makes the 4:5 feed card of any live listing for its own Instagram, Facebook
 * and TikTok pages — the same card and caption an agent makes from Mes biens
 * (ListingQuickShare, audience "team"), leading back to the listing on
 * lukkaplace.com. The page renders this only for a listing that is live
 * (shareBlocker), since the card's link would otherwise lead to a 404.
 *
 * Since 2026-11-06 the dialog also says where it is posted and records it
 * (TeamSocialShare); the same dialog opens from each row of /admin/listings.
 */
export default function TeamSocialCardButton({ listing }) {
  return <TeamSocialShare listing={listing} variant="button" />;
}
