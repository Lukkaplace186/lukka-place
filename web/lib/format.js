// Canonical price formatter — was copy-pasted identically across
// ListingCard.js, ListingCardVertical.js, FeaturedListingCard.js, and
// PropertyMap.js's InfoWindow. Consolidated here so lib/whatsapp.js can
// reuse the exact same real-price text the visitor already sees on the
// card/detail page, instead of a second, possibly-drifting implementation.
//
// `pricePeriod` (real data, once a listing has it — see
// services/db.js/openai.js in the engine repo, 'mois'|'an'|'total'|null)
// is optional and only refines a `rent`-purpose listing's suffix: absent,
// it defaults to the previous "/ mois" assumption (every rent listing
// synced before this field existed); 'an' renders "/ an" instead; 'total'
// or 'mois' both render the existing "/ mois" text (a one-time total rent
// figure is still effectively described the same way here).
export function formatPrice(price, purpose, pricePeriod) {
  const amount = Number(price).toLocaleString('fr-FR');
  if (purpose !== 'rent') return `${amount} $`;
  return pricePeriod === 'an' ? `${amount} $ / an` : `${amount} $ / mois`;
}
