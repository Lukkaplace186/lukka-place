/**
 * The homepage alert's search (components/HomeAlertPicker.js): Louer or
 * Acheter, one Kinshasa commune, an optional budget. Written with the
 * /listings param names, so the saved alert IS that results page, and the
 * signup round trip lands on it (QueryAlertButton).
 *
 * Pure. Returns null until a commune is picked — "every rental in the city"
 * is the whole feed, not an alert.
 *
 * @param {{transaction?: string, commune?: string, price_min?: string, price_max?: string}} input
 * @returns {string|null}
 */
export function homeAlertQuery({ transaction = 'location', commune = '', price_min = '', price_max = '' } = {}) {
  const name = String(commune || '').trim();
  if (!name) return null;
  const params = new URLSearchParams();
  params.set('transaction_type', transaction === 'vente' ? 'vente' : 'location');
  params.set('commune', name);
  if (price_min) params.set('price_min', String(price_min));
  if (price_max) params.set('price_max', String(price_max));
  return params.toString();
}

/**
 * The commune list the picker offers: Kinshasa communes with listings first
 * (real counts, most first), then the rest alphabetically. A popular entry
 * that is not a Kinshasa commune (Lubumbashi is a commune of its own city)
 * is left out — the alert searches Kinshasa, where `commune` alone applies.
 *
 * @param {{commune: string, count: number}[]} popular
 * @param {string[]} kinshasaCommunes
 */
export function homeAlertCommunes(popular = [], kinshasaCommunes = []) {
  const known = new Set(kinshasaCommunes);
  const withListings = popular.filter((row) => row?.commune && known.has(row.commune) && Number(row.count) > 0);
  const taken = new Set(withListings.map((row) => row.commune));
  const others = kinshasaCommunes.filter((name) => !taken.has(name)).sort((a, b) => a.localeCompare(b, 'fr'));
  return { popular: withListings.map((row) => ({ commune: row.commune, count: Number(row.count) })), others };
}
