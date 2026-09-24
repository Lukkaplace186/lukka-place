/**
 * Pure matching between one live listing and one demand cell
 * (lib/demandReport.js). Kept free of the database so the rule is testable.
 *
 * Cell shape (engine db.getDemandReport): { commune, transaction_type:
 * 'location'|'vente'|null, bedrooms: number|null, budget_min, budget_max }.
 */

const PURPOSE_FOR = { location: 'rent', vente: 'sale' };

/** A listing's price in the cell's unit: monthly for a rent, as-is for a sale. */
export function comparablePrice(row) {
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return row.purpose === 'rent' && row.price_period === 'an' ? price / 12 : price;
}

export function matchesDemandCell(row, cell) {
  if (!row.commune || row.commune !== cell.commune) return false;
  const purpose = PURPOSE_FOR[cell.transaction_type];
  if (purpose && row.purpose !== purpose) return false;
  if (cell.bedrooms !== null && cell.bedrooms !== undefined) {
    const beds = Number(row.beds);
    if (!Number.isFinite(beds) || beds < cell.bedrooms) return false;
  }
  if (cell.budget_min !== null || cell.budget_max !== null) {
    const price = comparablePrice(row);
    if (price === null) return false;
    if (cell.budget_max !== null && price > cell.budget_max) return false;
    if (cell.budget_min !== null && price < cell.budget_min) return false;
  }
  return true;
}

/** "600 – 1 000 $", "moins de 300 $", "plus de 2 000 $", or null. */
export function budgetBandText(cell, t) {
  const fmt = (n) => `${Number(n).toLocaleString('fr-FR')} $`;
  if (cell.budget_min === null && cell.budget_max === null) return t('admin.demand.budgetAny');
  if (cell.budget_min === null) return t('admin.demand.budgetUnder', { max: fmt(cell.budget_max) });
  if (cell.budget_max === null) return t('admin.demand.budgetOver', { min: fmt(cell.budget_min) });
  return `${fmt(cell.budget_min)} – ${fmt(cell.budget_max)}`;
}
