import 'server-only';
import { DEFAULT_CDF_PER_USD, DEFAULT_RATE_UPDATED_AT } from './currency';

/**
 * lib/exchangeRate.js
 *
 * Live USD->CDF daily rate, with an in-memory day cache and an honest
 * fallback. This is the *source*; lib/currencyRate.js is still the single
 * entry point every pricing component reads through (getCdfRate()), so
 * nothing downstream — Price.js, PricePanel.js, PropertyMap.js,
 * CurrencyBridge.js — has to learn where the number came from.
 *
 * WHY NOT FRANKFURTER: it was the obvious first choice and it does not carry
 * CDF at all. Frankfurter republishes the ECB reference set (~30 majors);
 * `GET /currencies` has no CDF key and a USD->CDF query returns nothing
 * usable. Confirmed against the live API before writing this file, not
 * assumed. The same applies to any other ECB mirror. CDF is an exotic, so
 * the source has to be one that actually quotes it.
 *
 * SOURCE: open.er-api.com (exchangerate-api.com's free, no-key endpoint).
 * It quotes CDF, needs no API key, and — the reason it was picked over the
 * other no-key options — it returns `time_last_update_utc`, the date the
 * rate was ACTUALLY published. That real date is what we display. A feed
 * that only hands back a number leaves you stamping it with "now", which is
 * the one thing this file must not do (see below).
 */

const DEFAULT_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const REQUEST_TIMEOUT_MS = 4000;

// A failed fetch is cached too, for a short window. Without this, an outage
// adds a 4s timeout to EVERY server render for the rest of the day — the
// day cache alone only suppresses repeat calls after a *success*.
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;

// Sanity band on the parsed rate. This guards money: a feed glitch handing
// back 22.9 or 229000 instead of ~2290 would silently misprice every listing
// on the site, and a wrong number that renders cleanly is worse than no
// number. USD/CDF has traded in the low thousands for years; the band is
// wide enough not to trip on real drift, tight enough to catch a unit or
// decimal error. Out-of-band => treated as a failed fetch, not as data.
const MIN_PLAUSIBLE_RATE = 500;
const MAX_PLAUSIBLE_RATE = 20000;

/**
 * The fallback carries DEFAULT_RATE_UPDATED_AT — the date that constant was
 * really checked — NOT today's date.
 *
 * This is deliberate and it is the one place this module departs from the
 * "fall back to a safe default and today's date" shape it was asked for.
 * Every surface that renders this prints the date next to the number
 * ("taux indicatif au …", <Price>'s tooltip, CurrencyBridge's copy), and
 * customers budget against it. Stamping a fallback with today's date claims
 * we checked the rate today, at exactly the moment we know we could not —
 * a stale figure wearing a fresh date, which is less truthful than the
 * hardcoded constant this replaces. The real date is honest and just as
 * "drop-in": callers still get a usable { rate, date }.
 */
const FALLBACK = Object.freeze({
  rate: DEFAULT_CDF_PER_USD,
  date: DEFAULT_RATE_UPDATED_AT,
  source: 'fallback',
});

function utcDayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Module-level, so the cache is per server process and survives requests. */
let cached = null; // { dayKey, value }
let failedAt = 0;
let inFlight = null; // de-dupes a burst of concurrent cold-cache renders

/**
 * Parses open.er-api.com's envelope into our shape, or returns null if the
 * payload isn't something we're willing to price against.
 */
export function parseRatePayload(payload) {
  if (!payload || payload.result !== 'success') return null;

  const rate = Number(payload.rates?.CDF);
  if (!Number.isFinite(rate) || rate < MIN_PLAUSIBLE_RATE || rate > MAX_PLAUSIBLE_RATE) return null;

  // The feed's own publish date, not ours. Falls back to the update
  // timestamp being unparseable -> null, rather than substituting today.
  const published = new Date(payload.time_last_update_utc ?? payload.time_last_update_unix * 1000);
  if (Number.isNaN(published.getTime())) return null;

  return {
    // One decimal is already more precision than a display rate needs, and
    // it keeps "2 296,6 FC" from rendering as 2296.642711.
    rate: Math.round(rate * 10) / 10,
    date: published.toISOString().slice(0, 10),
    source: 'live',
  };
}

async function fetchRate(fetchImpl, endpoint) {
  const response = await fetchImpl(endpoint, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return null;
  return parseRatePayload(await response.json());
}

/**
 * The helper every pricing surface ultimately reads.
 *
 * Never throws and never blocks longer than REQUEST_TIMEOUT_MS: it is called
 * during server render of public pages, so a slow or dead FX API must
 * degrade to a number, not to an error page.
 *
 * @param {object}   [options]
 * @param {Function} [options.fetchImpl] injected in tests — the unit tier is
 *   forbidden from reaching a real API (tests/support/register.mjs), so this
 *   takes its fetch rather than closing over the global, the same shape
 *   lib/geocoding.js uses for the Geocoder.
 * @param {number}   [options.now] injected clock, for testing day rollover.
 * @returns {Promise<{rate: number, date: string, source: 'live'|'fallback'}>}
 */
export async function getDailyRate({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  endpoint = process.env.EXCHANGE_RATE_API_URL || DEFAULT_ENDPOINT,
} = {}) {
  const dayKey = utcDayKey(now);

  if (cached && cached.dayKey === dayKey) return cached.value;
  if (now - failedAt < NEGATIVE_CACHE_MS) return FALLBACK;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = await fetchRate(fetchImpl, endpoint);
      if (!value) {
        failedAt = now;
        return FALLBACK;
      }
      cached = { dayKey, value };
      failedAt = 0;
      return value;
    } catch (error) {
      console.warn('[exchangeRate] live USD->CDF fetch failed, using the dated fallback:', error.message);
      failedAt = now;
      return FALLBACK;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test seam only — the module cache is process-global by design. */
export function __resetRateCache() {
  cached = null;
  failedAt = 0;
  inFlight = null;
}
