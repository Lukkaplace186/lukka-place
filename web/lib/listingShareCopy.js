import { placeLabel } from '@/lib/placeLabel';
import { formatPriceParts } from './format';
import { formatPhoneDisplay } from './phone';
import { entryTerms, formatArea, hasArea } from './listingView';
import { SITE_URL } from './constants';
import { cityOfListing, communeLabel } from './cities';

/**
 * The ready-to-paste text an agent posts with one of their listings — the
 * caption under the listing card on WhatsApp, a broadcast-list message, a
 * Facebook group post.
 *
 * Shaped for how Kinshasa commissionnaires actually advertise: purpose in
 * capitals first (À LOUER / À VENDRE is what people scan a Status for), then
 * price and place, the counts and entry terms as a short list, the agent, and
 * the link last so it stays tappable.
 *
 * THE SYMBOLS (2026-10-06 redesign, product direction "slick, modern"): one
 * 📍 for the place and "▸" list markers, instead of an emoji on every line
 * (🏠 💰 🛏️ 🔑 📞 👉). "▸" is a plain text character, so it renders the same
 * small and quiet way on every phone, and the caption reads like the card it
 * sits under rather than a chain message.
 *
 * ALWAYS FRENCH, deliberately — not the agent's UI language. This text is
 * read by the agent's own customers in Kinshasa, not by the agent; rendering
 * it in English because the agent toggled their dashboard to EN would put the
 * wrong language in front of the market. Same reasoning web/CLAUDE.md gives
 * for the `flexibility` option values.
 *
 * Every line is a real field or it is left out — no "Idéal pour famille", no
 * invented selling point, and the entry costs itemised by name (garantie,
 * avance, commission), never one summed "Garantie : 5 mois".
 *
 * @param {object} listing  A row with price/purpose/price_period/beds/bath/
 *   area/units_count/quartier/commune/reference/deposit_months/advance_months/
 *   commission_months.
 * @param {{typeText?: string|null, url?: string|null, contactPhone?: string|null,
 *          contactName?: string|null, style?: 'whatsapp'|'social'}} [options]
 *   typeText is resolved by the caller (typeLabel with a French translator).
 *   `style: 'social'` is the feed card's caption (Instagram, Facebook): the
 *   same lines without the *…*, WITHOUT the agent's number, ending on the
 *   listing's link on Lukka Place and socialHashtags(). A social post — the
 *   team's or an agent's — sends people back to the platform, where the
 *   visit request and the agent's contact are (product direction 2026-10-26).
 */
export function buildListingSocialCopy(listing, { typeText = null, url = null, contactPhone = null, contactName = null, style = 'whatsapp' } = {}) {
  const lines = [];
  const social = style === 'social';
  // WhatsApp renders *…* as bold. Elsewhere (a Facebook group, a pasted SMS)
  // the asterisks show literally — accepted deliberately for the WhatsApp
  // captions, since that is where they are posted and the emphasis is what
  // makes a Status legible at a glance. The feed caption goes to Instagram
  // and Facebook, which have no such markup, so it carries none.
  const bold = (text) => (social ? text : `*${text}*`);

  const purpose = listing.purpose === 'sale' ? 'À VENDRE' : listing.purpose === 'rent' ? 'À LOUER' : null;
  const head = [purpose ? bold(purpose) : null, typeText].filter(Boolean).join(' · ');
  if (head) lines.push(head);

  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  lines.push(period ? `${bold(amount)} ${period}` : bold(amount));

  const place = placeLabel(listing);
  if (place) lines.push(`📍 ${place}`);

  const details = [];
  const specs = roomSpecs(listing);
  if (specs.length) details.push(specs.join(' · '));
  const entry = entryCostLine(listing);
  if (entry) details.push(entry);
  const reference = typeof listing.reference === 'string' ? listing.reference.trim() : '';
  if (reference) details.push(`Réf. ${reference}`);
  if (details.length) lines.push('', ...details.map((line) => `▸ ${line}`));

  // Only a number the public listing page would itself publish — see
  // agentContactPhone. An agent sharing their own listing usually wants to be
  // called directly; a caption is not the place to leak an unverified number.
  if (contactPhone && !social) {
    const name = typeof contactName === 'string' && contactName.trim() ? contactName.trim() : 'Contact';
    lines.push('', `${bold(name)} · ${contactPhone}`);
  }

  if (url) lines.push('', social ? 'Photos, visite et contact de l’agent sur Lukka Place ↓' : 'Photos et visite ↓', url);

  if (social) {
    const tags = socialHashtags(listing, { typeText });
    if (tags.length) lines.push('', tags.join(' '));
  }

  return lines.join('\n');
}

/** "Mont-Ngafula" → "MontNgafula", "à louer" → "ÀLouer". Letters and digits only. */
function hashtagWord(text) {
  return String(text || '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

/**
 * The feed caption's hashtags, from the listing's own fields only: its city,
 * its commune, what it is and the transaction ("#AppartementÀLouer"), and
 * #LukkaPlace. A field that is not known is left out, never guessed.
 */
export function socialHashtags(listing, { typeText = null } = {}) {
  const purpose = listing.purpose === 'sale' ? 'à vendre' : listing.purpose === 'rent' ? 'à louer' : '';
  const words = [
    cityOfListing(listing),
    listing.commune ? communeLabel(listing.commune) : null,
    typeText ? `${typeText} ${purpose}` : null,
    'Lukka Place',
  ];
  const seen = new Set();
  const tags = [];
  for (const word of words) {
    const tag = hashtagWord(word);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(`#${tag}`);
  }
  return tags;
}

/**
 * "Garantie 3 mois · Avance 1 mois · Commission 1 mois" — each stated part by
 * its own name, in the order of the local "3 + 1 + 1" notation; a deposit
 * alone is "Garantie 3 mois". Null when no entry terms are stated.
 */
export function entryCostLine(listing) {
  const terms = entryTerms(listing);
  if (!terms) return null;
  const names = ['Garantie', 'Avance', 'Commission'];
  return terms.parts.map((months, i) => `${names[i]} ${months} mois`).join(' · ');
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

/** "2 chambres", "1 salle de bain", "120 m²", "6 portes" — only counts that are real. */
export function roomSpecs(listing) {
  return roomSpecItems(listing).map((item) => item.text);
}

/**
 * The same counts with the line icon the listing card draws beside each
 * (lib/marketing/icons.js LINE_ICONS): bed, bath, area, door.
 */
export function roomSpecItems(listing) {
  const items = [];
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

  const beds = Number(listing.beds);
  if (beds > 0) items.push({ icon: 'bed', text: plural(beds, 'chambre', 'chambres') });
  const bath = Number(listing.bath);
  if (bath > 0) items.push({ icon: 'bath', text: plural(bath, 'salle de bain', 'salles de bain') });
  if (hasArea(listing.area)) items.push({ icon: 'area', text: `${formatArea(listing.area)} m²` });
  const units = Number(listing.units_count);
  if (listing.units_count != null && units > 0) items.push({ icon: 'door', text: plural(units, 'porte', 'portes') });

  return items;
}

/**
 * `utm_source` labels for the links an agent shares, one per way out of the
 * share kit, so /admin's traffic-source breakdown can say which channel
 * actually brings visitors. They land in `page_views.source` and
 * `whatsapp_clicks.source` via lib/analyticsClient.js, which forwards the
 * label from the landing URL. Lower-case ASCII: sourceFromRequest lower-cases
 * and truncates to 64 anyway, and a label that changes case between releases
 * would split one channel into two rows.
 */
export const SHARE_SOURCES = Object.freeze({
  image: 'wa_status',
  whatsapp: 'wa_message',
  copy: 'partage_agent',
  // The feed card's caption (Instagram, Facebook), ListingQuickShare's 4:5.
  social: 'reseaux_sociaux',
});

/**
 * The same feed caption when Lukka Place posts it on its own pages
 * (/admin/listings/[id], lib/marketing/shareKit.js audience 'team'), so the
 * company's posts and the agents' read as two sources.
 */
export const TEAM_SOCIAL_SOURCE = 'lukka_reseaux';

/**
 * `medium` / `campaign` are optional and only appended after a source. Only
 * `utm_source` is recorded today (lib/analyticsClient.js forwards that one
 * label); the other two survive in the link for any later reader.
 */
export function listingPublicUrl(id, { source = null, medium = null, campaign = null } = {}) {
  const url = `${SITE_URL}/listings/${id}`;
  if (!source) return url;
  const parts = [`utm_source=${encodeURIComponent(source)}`];
  if (medium) parts.push(`utm_medium=${encodeURIComponent(medium)}`);
  if (campaign) parts.push(`utm_campaign=${encodeURIComponent(campaign)}`);
  return `${url}?${parts.join('&')}`;
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
