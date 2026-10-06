/**
 * "Nous avons compris : Gombe · 2 ch.+ · ≤ 800 $" — the hero search card's
 * read-back of what lib/searchParser.js took from the typed text, shown as
 * chips before the visitor searches (2026-10-06 storefront upgrade). It only
 * restates the parse; it never adds a filter of its own, and an empty list
 * means the card shows nothing (free text then searches as words, as before).
 *
 * Pure, so tests/unit/storefront-upgrade.test.js can pin it. `t` is the
 * caller's translator.
 */
export function understoodChips(parsed, t) {
  if (!parsed) return [];
  const chips = [];
  if (parsed.transaction_type === 'location') chips.push({ key: 'tx', label: t('home.search.rent') });
  if (parsed.transaction_type === 'vente') chips.push({ key: 'tx', label: t('home.search.buy') });
  if (parsed.property_type) {
    const type = parsed.parcelle_subtype || parsed.property_type;
    chips.push({ key: 'type', label: type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ') });
  }
  if (parsed.near) chips.push({ key: 'near', label: t('home.search.near', { place: parsed.near }) });
  else if (parsed.commune) {
    const places = parsed.communes?.length > 1 ? parsed.communes : [parsed.commune];
    chips.push({ key: 'place', label: [parsed.quartier, ...places].filter(Boolean).join(', ') });
  }
  if (parsed.beds_min != null) chips.push({ key: 'beds', label: t('home.search.bedsMin', { count: parsed.beds_min }) });
  const money = (n) => Number(n).toLocaleString(t.locale === 'en' ? 'en-GB' : 'fr-FR');
  if (parsed.price_min != null && parsed.price_max != null) {
    chips.push({ key: 'price', label: `${money(parsed.price_min)} – ${money(parsed.price_max)} $` });
  } else if (parsed.price_max != null) chips.push({ key: 'price', label: `≤ ${money(parsed.price_max)} $` });
  else if (parsed.price_min != null) chips.push({ key: 'price', label: `≥ ${money(parsed.price_min)} $` });
  return chips;
}
