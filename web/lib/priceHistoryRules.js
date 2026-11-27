/**
 * "Historique du prix" on a listing page (2026-11-27), pure: rows of
 * property_price_history (the database trigger writes one on every price,
 * currency, purpose or period change, from every writer) -> what a visitor
 * may be shown. Only recorded facts, never an estimate:
 *
 * - The starting point is the price the listing had when it went public:
 *   the last row at or before publication. Changes before that are a draft
 *   being corrected, not a price anyone saw (same bound as the "Prix en
 *   baisse" badge, lib/listings.js).
 * - Only prices with the listing's CURRENT currency, purpose and period are
 *   compared. A period or purpose that moved (mois / day / jour, rent / sale)
 *   is a corrected label on real data (listing #340, 2026-10-22), not a price
 *   move, and two prices on different terms cannot be compared anyway.
 * - Each later row whose price differs from the one before is a step. A move
 *   of more than 50 % either way is a corrected typo (an extra zero, #831),
 *   the same reading as the badge, and is left out rather than shown as a
 *   market change.
 * - Nothing to show (no change after publication) -> null: the page then
 *   draws no section at all.
 */

export const TYPO_RATIO = 2;

function sameTerms(a, b) {
  return (a.currency ?? null) === (b.currency ?? null)
    && (a.purpose ?? null) === (b.purpose ?? null)
    && (a.price_period ?? null) === (b.price_period ?? null);
}

function usable(price) {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {Array<{price, currency, purpose, price_period, changed_at, after_publish}>} rows oldest first
 * @param {string|Date|null} publishedAt
 * @returns {null | { start: {price, purpose, price_period, at}, steps: Array<{price, purpose, price_period, at, percent: number, direction: 'down'|'up'}> }}
 */
export function buildPriceHistory(rows, publishedAt) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const current = rows[rows.length - 1];
  const onTerms = rows.filter((row) => sameTerms(row, current));
  const before = onTerms.filter((row) => !row.after_publish);
  const after = onTerms.filter((row) => row.after_publish);
  if (after.length === 0) return null;

  // The price visitors first saw. A listing whose only rows are after
  // publication (history began after it went live) starts from its first row.
  // Dated at publication only when it was the price then; otherwise when it
  // was recorded (terms corrected after going live).
  const startedBeforePublish = before.length > 0;
  const startRow = startedBeforePublish ? before[before.length - 1] : after.shift();
  if (!startRow || usable(startRow.price) === null) return null;

  const steps = [];
  let previous = startRow;
  for (const row of after) {
    const price = usable(row.price);
    if (price === null) continue;
    const prevPrice = usable(previous.price);
    if (prevPrice === null || price === prevPrice) {
      previous = row;
      continue;
    }
    const ratio = price / prevPrice;
    const percent = Math.round((ratio - 1) * 100);
    if (ratio > TYPO_RATIO || ratio < 1 / TYPO_RATIO || percent === 0) {
      previous = row;
      continue;
    }
    steps.push({ price, purpose: row.purpose, price_period: row.price_period, at: row.changed_at, percent, direction: percent < 0 ? 'down' : 'up' });
    previous = row;
  }
  if (steps.length === 0) return null;
  return {
    start: { price: usable(startRow.price), purpose: startRow.purpose, price_period: startRow.price_period, at: startedBeforePublish ? publishedAt || startRow.changed_at : startRow.changed_at },
    steps,
  };
}
