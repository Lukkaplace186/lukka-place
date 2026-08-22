// Client-side display conversion only — every listing's real stored price
// is USD (see web/CLAUDE.md: no `currency` column exists on the live
// `properties` table today). This is a manually-set, dated exchange rate,
// not a live FX API — a static figure that's honestly labeled as an
// estimate is more truthful than one that looks live but silently goes
// stale. Source: Wise mid-market rate, https://wise.com/gb/currency-converter/usd-to-cdf-rate,
// checked 2026-08-18 (~2,292 CDF per USD; the real market rate moves day to
// day — update this constant/date together if it drifts noticeably).
export const CDF_PER_USD = 2292;
export const EXCHANGE_RATE_UPDATED_AT = '2026-08-18';

export function convertToCdf(usdAmount) {
  const amount = Number(usdAmount);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * CDF_PER_USD);
}
