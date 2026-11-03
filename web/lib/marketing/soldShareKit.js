import 'server-only';
import { frenchTypeText } from '../listingFlyer';
import { agentPageUrl } from '../listingShareCopy';
import { placeLabel } from '../placeLabel';
import { buildShareKit } from './shareKit';

/**
 * "Loué via Lukka Place" (2026-11-03) — the share card an agent gets right
 * after marking a listing let or sold (components/MarkListingSoldDialog.js).
 *
 * The listing's own card, drawn by the same renderer from the same pack, with
 * three fields swapped:
 *  - where the price goes, "Loué" / "Vendu" and "via Lukka Place". No price
 *    at all: the asking price beside "Loué" would read as the deal price, and
 *    the agreed price (`sold_price`) is the landlord's business, not a post.
 *  - the pill on the photo says "AFFAIRE CONCLUE".
 *  - the captions link to the AGENT'S page, not the listing: a closed listing
 *    leaves public search and its page no longer opens. The page carries their
 *    partner code like every link in their kit.
 *
 * Only for a listing that really is closed (`listing_status = 'closed'`);
 * anything else gets `shareable: false`.
 */
export const SOLD_SHARE_SOURCE = 'bien_conclu';

export function soldWord(purpose) {
  return purpose === 'sale' ? 'Vendu' : 'Loué';
}

/**
 * @param {{purpose: string, typeText: string|null, place: string|null, pageUrl: string|null,
 *          style?: 'whatsapp'|'social'}} input
 */
export function buildSoldCaption({ purpose, typeText, place, pageUrl, style = 'whatsapp' }) {
  const word = soldWord(purpose);
  const verb = word.toLowerCase();
  const social = style === 'social';
  const headline = social ? `✅ ${word.toUpperCase()} via Lukka Place` : `✅ *${word.toUpperCase()} via Lukka Place*`;
  const what = [typeText, place ? `📍 ${place}` : null].filter(Boolean).join(' · ');
  const lines = [headline];
  if (what) lines.push(what);
  lines.push('', `Encore un bien ${verb} avec Lukka Place.`);
  if (pageUrl) lines.push('Vous cherchez un bien ? Voyez mes autres annonces :', pageUrl);
  if (social) lines.push('', '#Kinshasa #LukkaPlace #Immobilier');
  return lines.join('\n');
}

export function buildSoldShareKit(listing, { refCode = null, agentId = null } = {}) {
  const base = buildShareKit(listing, { audience: 'agent', refCode, agentId });
  if (listing?.listing_status !== 'closed') {
    return { ...base, audience: 'sold', shareable: false, blocker: 'not_closed' };
  }
  const pageUrl = agentPageUrl(agentId, { source: SOLD_SHARE_SOURCE, ref: refCode });
  const typeText = frenchTypeText(listing);
  const place = placeLabel(listing) || null;
  const whatsapp = buildSoldCaption({ purpose: listing.purpose, typeText, place, pageUrl });
  const social = buildSoldCaption({ purpose: listing.purpose, typeText, place, pageUrl, style: 'social' });
  return {
    ...base,
    audience: 'sold',
    shareable: true,
    blocker: null,
    url: pageUrl,
    copy: whatsapp,
    copies: { image: whatsapp, whatsapp, copy: whatsapp, social },
    pack: {
      ...base.pack,
      purposeLabel: 'AFFAIRE CONCLUE',
      amount: soldWord(listing.purpose),
      period: 'via Lukka Place',
      // The reference / listing number pill points at a page that is gone.
      refLabel: null,
    },
  };
}
