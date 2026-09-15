/**
 * "Trouver pour moi" pre-filled from what the customer already told us: their
 * most recent saved search. Someone who saved "2 chambres à Gombe, max 900 $"
 * and then asks us to find something should not have to type it again.
 *
 * Only values the saved query actually carries, and only in the shapes the
 * form accepts — a commune missing from today's option list is left out
 * rather than injected, a bedroom minimum above the form's "4 et plus" folds
 * into it. Nothing is guessed: no saved search, or one with none of these
 * fields, prefills nothing.
 *
 * Plain module, so the unit tier can test the mapping.
 *
 * @param {{query?: string, label?: string}|null|undefined} search
 * @param {string[]} [communeOptions] the form's real commune list
 * @returns {null|{label: string, transactionType: 'vente'|'location'|null, communes: string[],
 *   budgetMin: string, budgetMax: string, bedrooms: string}}
 */
export function prefillFromSavedSearch(search, communeOptions = []) {
  if (!search?.query) return null;
  const params = new URLSearchParams(search.query);

  const rawType = params.get('transaction_type');
  const transactionType = rawType === 'vente' || rawType === 'location' ? rawType : null;

  const commune = params.get('commune');
  const communes = commune && communeOptions.includes(commune) ? [commune] : [];

  const amount = (value) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  };
  const beds = Number.parseInt(params.get('beds_min'), 10);
  const bedrooms = Number.isFinite(beds) && beds > 0 ? String(Math.min(beds, 4)) : '';

  const prefill = {
    label: search.label || '',
    transactionType,
    communes,
    budgetMin: amount(params.get('price_min')),
    budgetMax: amount(params.get('price_max')),
    bedrooms,
  };
  const hasAnything = transactionType || communes.length > 0 || prefill.budgetMin || prefill.budgetMax || bedrooms;
  return hasAnything ? prefill : null;
}
