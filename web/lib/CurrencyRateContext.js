'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_CDF_PER_USD, DEFAULT_RATE_UPDATED_AT } from './currency';

/**
 * Threads the server-read exchange rate (lib/currencyRate.js) down to
 * client components that need it synchronously at render time (Price.js,
 * PropertyMap.js) — a plain server-only DB read can't be called from a
 * client component, so app/(site)/layout.js fetches it once per request and
 * provides it here. The default value is only ever seen if a page somehow
 * renders <Price>/<PropertyMap> outside the (site) layout's provider — real
 * pages always get the live rate.
 */
const CurrencyRateContext = createContext({
  cdfPerUsd: DEFAULT_CDF_PER_USD,
  updatedAt: DEFAULT_RATE_UPDATED_AT,
});

export function CurrencyRateProvider({ rate, children }) {
  return <CurrencyRateContext.Provider value={rate}>{children}</CurrencyRateContext.Provider>;
}

export function useCdfRate() {
  return useContext(CurrencyRateContext);
}
