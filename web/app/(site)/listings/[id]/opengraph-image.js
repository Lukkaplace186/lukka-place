import { getListingById } from '@/lib/listings';
import { renderListingOgCard } from '@/lib/listingOgRender';

/**
 * The listing's link preview — what WhatsApp, Facebook and X show when its
 * URL is pasted. Next adds og:image / og:image:width / height / type to the
 * listing page's <head> from this file, ahead of anything generateMetadata
 * says; twitter-image.js beside it serves the same card as twitter:image.
 *
 * THE "ÉDITORIAL" CARD (2026-11-06, design canvas "Aperçu lien prestige",
 * chosen by the owner over a dark full-photo card that read as a template):
 * the listing's three brightest photos on the left — one tall, two stacked,
 * separated by thin gaps of the same ivory as the column — and an ivory
 * column on the right with "À LOUER · GOMBE" in royal blue, the price in the
 * serif, "par mois", a rule, the type and the room counts in words, and the
 * one-colour royal logo with lukkaplace.com at the foot. No dark veil over
 * the photos, no icons on the facts, no button: Facebook prints the link's
 * title and domain under the image already.
 *
 * Photos: agents upload in any order, so the card does not take the first
 * three — lib/listingOgImage.js loadOgPhotos ranks the listing's own photos
 * by brightness and drops duplicates. Two photos sit side by side, one fills
 * the block, none draws the blue block with the white logo (never a stand-in
 * photo). The old centre-square constraint is gone: WhatsApp's square
 * thumbnail is ~100px and prints the title beside it.
 *
 * What the card says is lib/listingOgCard.js (pure, tested). Same public gate
 * as the page (getListingById): a pending, rejected or archived listing
 * answers 404, never a preview of it.
 *
 * Always French: a crawler sends no locale cookie, and the people the link is
 * sent to read the market's language. Cached 10 minutes, so a price change
 * reaches a NEW share quickly; WhatsApp and Facebook keep their own copy of a
 * preview they already fetched.
 */

export const alt = 'Annonce Lukka Place : photos, prix et caractéristiques du bien';
// Laid out on a 1200×630 grid, DRAWN at 2× (lib/listingOgImage.js OG_SCALES):
// Facebook shows the preview on 2–3× phone screens, and a 1200px image was
// being enlarged there, blurring the text. A listing whose photos make the 2×
// file too heavy for WhatsApp is drawn at 1.5× or 1× instead (same 1.91:1).
export const size = { width: 2400, height: 1260 };
export const contentType = 'image/jpeg';
export const revalidate = 600;

/**
 * The drawing and its cache live in lib/listingOgRender.js, so the share
 * dialogs can warm the card before a link is posted (Facebook's crawler timed
 * out on a 6–7 s drawing and showed a grey box).
 */
export default async function Image({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) return new Response('Not found', { status: 404 });

  const { body, type, scale, quality, cached } = await renderListingOgCard(listing);
  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400',
      'Content-Type': type,
      'X-Og-Scale': `${scale}x q${quality ?? 'png'}${cached ? ' cached' : ''}`,
    },
  });
}
