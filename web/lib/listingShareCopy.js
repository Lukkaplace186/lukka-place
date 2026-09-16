import { formatPrice } from './format';
import { formatPhoneDisplay } from './phone';
import { entryTerms, hasArea } from './listingView';
import { SITE_URL } from './constants';

/**
 * The ready-to-paste text an agent posts with one of their listings — a
 * WhatsApp Status caption, a broadcast-list message, a Facebook group post.
 *
 * Shaped for how Kinshasa commissionnaires actually advertise: purpose in
 * capitals first (À LOUER / À VENDRE is what people scan a Status for), then
 * place, price, rooms, the "Garantie 3 + 1 + 1" terms, and the link last so it
 * stays tappable and unfurls into the listing card.
 *
 * ALWAYS FRENCH, deliberately — not the agent's UI language. This text is
 * read by the agent's own customers in Kinshasa, not by the agent; rendering
 * it in English because the agent toggled their dashboard to EN would put the
 * wrong language in front of the market. Same reasoning web/CLAUDE.md gives
 * for the `flexibility` option values.
 *
 * Every line is a real field or it is left out — no "Idéal pour famille", no
 * invented selling point, no "Garantie : 5 mois" summed total (the itemised
 * parts are shown, the way KeyFacts shows them).
 *
 * @param {object} listing  A row with price/purpose/price_period/beds/bath/
 *   area/units_count/quartier/commune/reference/deposit_months/advance_months/
 *   commission_months.
 * @param {{typeText?: string|null, url?: string|null}} [options]
 *   typeText is resolved by the caller (typeLabel with a French translator).
 */
export function buildListingSocialCopy(listing, { typeText = null, url = null, contactPhone = null } = {}) {
  const lines = [];
  // WhatsApp renders *…* as bold. Elsewhere (a Facebook group, a pasted SMS)
  // the asterisks show literally — accepted deliberately, since WhatsApp is
  // where this text is posted and the emphasis is what makes a Status legible
  // at a glance.
  const bold = (text) => `*${text}*`;

  const purpose = listing.purpose === 'sale' ? 'À VENDRE' : listing.purpose === 'rent' ? 'À LOUER' : null;
  const head = [purpose ? bold(purpose) : null, typeText].filter(Boolean).join(' · ');
  if (head) lines.push(`🏠 ${head}`);

  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  if (place) lines.push(`📍 ${bold(place)}`);

  lines.push(`💰 ${bold(formatPrice(listing.price, listing.purpose, listing.price_period))}`);

  const specs = roomSpecs(listing);
  if (specs.length) lines.push(`🛏️ ${specs.join(' · ')}`);

  const terms = entryTerms(listing);
  if (terms) lines.push(`🔑 Garantie : ${terms.parts.join(' + ')} mois`);

  const reference = typeof listing.reference === 'string' ? listing.reference.trim() : '';
  if (reference) lines.push(`Réf. ${reference}`);

  // Only a number the public listing page would itself publish — see
  // agentContactPhone. An agent sharing their own listing usually wants to be
  // called directly; a caption is not the place to leak an unverified number.
  if (contactPhone) lines.push('', `📞 ${bold('Contact agent')} : ${contactPhone}`);

  if (url) lines.push('', `👉 Photos et visite : ${url}`);

  return lines.join('\n');
}

/**
 * The agent's number, or null. Same rule the listing page applies before it
 * prints one (lib/listings.js): the agent proved they hold it AND the team has
 * not switched direct routing off. Used by the caption and by the flyer.
 */
export function agentContactPhone(listing) {
  const routable = listing?.agent_phone_verified_at && listing?.agent_direct_routing_enabled !== false;
  if (!routable) return null;
  return formatPhoneDisplay(String(listing.agent_phone_raw || '').trim()) || null;
}

/**
 * The flyer's one-line detail row: "Appartement • 24 Novembre, Lingwala •
 * 2 ch • 2 sdb". Abbreviated because it is set at 30px across a 1080px card
 * where the full words wrap; the caption keeps the long forms.
 */
export function compactSpecs(listing) {
  const specs = [];
  const beds = Number(listing.beds);
  if (beds > 0) specs.push(`${beds} ch`);
  const bath = Number(listing.bath);
  if (bath > 0) specs.push(`${bath} sdb`);
  if (hasArea(listing.area)) specs.push(`${listing.area} m²`);
  const units = Number(listing.units_count);
  if (listing.units_count != null && units > 0) specs.push(`${units} portes`);
  return specs;
}

/** "2 chambres", "1 salle de bain", "120 m²", "6 portes" — only counts that are real. */
export function roomSpecs(listing) {
  const specs = [];
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  const beds = Number(listing.beds);
  if (beds > 0) specs.push(plural(beds, 'chambre', 'chambres'));
  const bath = Number(listing.bath);
  if (bath > 0) specs.push(plural(bath, 'salle de bain', 'salles de bain'));
  if (hasArea(listing.area)) specs.push(`${listing.area} m²`);
  const units = Number(listing.units_count);
  if (listing.units_count != null && units > 0) specs.push(plural(units, 'porte', 'portes'));

  return specs;
}

export function listingPublicUrl(id) {
  return `${SITE_URL}/listings/${id}`;
}

/**
 * Why a listing cannot be advertised yet, or null when it can. A flyer and a
 * shared link both point at the PUBLIC page, and that page 404s for anything
 * not `status = 1 AND approve_status = 1` — so sharing one would send the
 * agent's customers to a dead link. Under-offer and closed listings are off
 * the market; advertising them invites enquiries nobody can honour.
 *
 * @returns {'pending'|'rejected'|'archived'|'under_offer'|'closed'|null}
 */
export function shareBlocker(listing) {
  const approve = Number(listing.approve_status);
  if (approve === 2) return 'rejected';
  if (approve !== 1) return 'pending';
  if (listing.listing_status === 'closed') return 'closed';
  if (Number(listing.status) !== 1) return 'archived';
  if (listing.listing_status === 'under_offer') return 'under_offer';
  return null;
}
