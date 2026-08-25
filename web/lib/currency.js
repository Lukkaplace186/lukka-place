// Client-safe: pure conversion + fallback values only. The real,
// admin-editable rate is read server-side by lib/currencyRate.js
// (server-only, touches Postgres) and threaded down to client components via
// lib/CurrencyRateContext.js — this file itself must stay importable from
// 'use client' components (Price.js, PropertyMap.js), so it can never pull
// in 'server-only' or the DB pool.
//
// DEFAULT_CDF_PER_USD/DEFAULT_RATE_UPDATED_AT are only ever used as a
// fallback (empty/unreachable exchange_rates table) — see
// lib/currencyRate.js's getCdfRate(). Source of the original figure: Wise
// mid-market rate, https://wise.com/gb/currency-converter/usd-to-cdf-rate,
// checked 2026-08-18.
export const DEFAULT_CDF_PER_USD = 2292;
export const DEFAULT_RATE_UPDATED_AT = '2026-08-18';

export function convertToCdf(usdAmount, cdfPerUsd) {
  const amount = Number(usdAmount);
  const rate = Number(cdfPerUsd);
  if (!Number.isFinite(amount) || !Number.isFinite(rate)) return null;
  return Math.round(amount * rate);
}
