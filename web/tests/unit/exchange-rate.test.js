import test from 'node:test';
import assert from 'node:assert/strict';
import { getDailyRate, parseRatePayload, __resetRateCache } from '@/lib/exchangeRate';
import { getCdfRate } from '@/lib/currencyRate';
import { DEFAULT_CDF_PER_USD, DEFAULT_RATE_UPDATED_AT } from '@/lib/currency';
import { enqueue, reset as resetPool } from '../support/fakePool.js';

/**
 * The live USD->CDF feed (lib/exchangeRate.js) and the precedence rule that
 * picks between it and an admin's manual entry (lib/currencyRate.js).
 *
 * Everything here drives an INJECTED fetch. The unit tier is forbidden from
 * reaching a real API (tests/support/register.mjs blanks every outbound
 * credential), and a test depending on the real FX endpoint would also fail
 * offline and change its expected numbers daily.
 *
 * The payload below is a real open.er-api.com response, captured live
 * 2026-09-09 — not a hand-written guess at the shape.
 */
const LIVE_PAYLOAD = {
  result: 'success',
  provider: 'https://www.exchangerate-api.com',
  time_last_update_unix: 1788825751,
  time_last_update_utc: 'Tue, 08 Sep 2026 00:02:31 +0000',
  time_next_update_utc: 'Wed, 09 Sep 2026 00:35:41 +0000',
  base_code: 'USD',
  rates: { EUR: 0.85, CDF: 2296.642711, USD: 1 },
};

const DAY = '2026-09-09T10:00:00.000Z';

function okFetch(payload = LIVE_PAYLOAD) {
  const counter = { n: 0 };
  const impl = async () => {
    counter.n += 1;
    return { ok: true, json: async () => payload };
  };
  impl.counter = counter;
  return impl;
}

test.beforeEach(() => {
  __resetRateCache();
  resetPool();
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test('parses a real open.er-api.com payload into { rate, date }', () => {
  const parsed = parseRatePayload(LIVE_PAYLOAD);
  assert.equal(parsed.rate, 2296.6);
  // The feed's OWN publish date (08 Sep), not the day we happen to ask.
  assert.equal(parsed.date, '2026-09-08');
  assert.equal(parsed.source, 'live');
});

test('rejects a rate off by a factor — a unit error must never price listings', () => {
  for (const bad of [22.9, 229000, 0, -2290, null, undefined, 'abc', NaN]) {
    const parsed = parseRatePayload({ ...LIVE_PAYLOAD, rates: { CDF: bad } });
    assert.equal(parsed, null, `rate ${JSON.stringify(bad)} should have been rejected`);
  }
});

test('rejects a payload that is not a success envelope', () => {
  assert.equal(parseRatePayload({ result: 'error', rates: { CDF: 2296 } }), null);
  assert.equal(parseRatePayload({ rates: { CDF: 2296 } }), null);
  assert.equal(parseRatePayload(null), null);
});

test('rejects an unparseable publish date rather than substituting today', () => {
  const parsed = parseRatePayload({
    ...LIVE_PAYLOAD,
    time_last_update_utc: 'not a date',
    time_last_update_unix: NaN,
  });
  assert.equal(parsed, null);
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

test('caches for the day — a second call the same day issues no second request', async () => {
  const fetchImpl = okFetch();
  const first = await getDailyRate({ fetchImpl, now: Date.parse(DAY) });
  const second = await getDailyRate({ fetchImpl, now: Date.parse(DAY) + 60_000 });

  assert.equal(fetchImpl.counter.n, 1);
  assert.deepEqual(first, second);
  assert.equal(first.rate, 2296.6);
});

test('refetches once the UTC day rolls over', async () => {
  const fetchImpl = okFetch();
  await getDailyRate({ fetchImpl, now: Date.parse('2026-09-09T23:59:00Z') });
  await getDailyRate({ fetchImpl, now: Date.parse('2026-09-10T00:01:00Z') });
  assert.equal(fetchImpl.counter.n, 2);
});

test('a burst of concurrent cold-cache renders issues exactly ONE request', async () => {
  // The real failure this guards: getCdfRate() runs during server render of
  // every public page, so a cold cache under load means N simultaneous
  // outbound calls, not one.
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await gate;
    return { ok: true, json: async () => LIVE_PAYLOAD };
  };

  const all = Promise.all(
    Array.from({ length: 12 }, () => getDailyRate({ fetchImpl, now: Date.parse(DAY) })),
  );
  release();
  const results = await all;

  assert.equal(calls, 1);
  for (const r of results) assert.equal(r.rate, 2296.6);
});

// ---------------------------------------------------------------------------
// Fallback — the honesty contract
// ---------------------------------------------------------------------------

test('a network failure falls back to the default carrying its REAL date, never today', async () => {
  const fetchImpl = async () => {
    throw new Error('ECONNREFUSED');
  };
  const rate = await getDailyRate({ fetchImpl, now: Date.parse(DAY) });

  assert.equal(rate.rate, DEFAULT_CDF_PER_USD);
  assert.equal(rate.source, 'fallback');
  // The whole point: the fallback must NOT claim to have been checked today.
  assert.equal(rate.date, DEFAULT_RATE_UPDATED_AT);
  assert.notEqual(rate.date, '2026-09-09');
});

test('a non-2xx response falls back rather than throwing into a page render', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const rate = await getDailyRate({ fetchImpl, now: Date.parse(DAY) });
  assert.equal(rate.source, 'fallback');
  assert.equal(rate.date, DEFAULT_RATE_UPDATED_AT);
});

test('a sustained outage is not retried on every render', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('down');
  };

  const t0 = Date.parse(DAY);
  await getDailyRate({ fetchImpl, now: t0 });
  await getDailyRate({ fetchImpl, now: t0 + 1000 });
  await getDailyRate({ fetchImpl, now: t0 + 60_000 });
  assert.equal(calls, 1, 'negative cache should suppress retries inside the window');

  // ...but it does recover once the window passes.
  await getDailyRate({ fetchImpl, now: t0 + 6 * 60 * 1000 });
  assert.equal(calls, 2);
});

// ---------------------------------------------------------------------------
// Precedence: getCdfRate() is what every pricing component actually reads
// ---------------------------------------------------------------------------

test('getCdfRate serves the live feed when no admin has overridden it', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => LIVE_PAYLOAD }));
  enqueue([]); // no exchange_rates row

  const { cdfPerUsd, updatedAt } = await getCdfRate();
  assert.equal(cdfPerUsd, 2296.6);
  assert.equal(updatedAt, '2026-09-08');
});

test('a STALE admin entry does not outrank a fresher live rate', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => LIVE_PAYLOAD }));
  enqueue([{ cdf_per_usd: 2292, updated_at: '2026-08-18T00:00:00.000Z' }]);

  const { cdfPerUsd, updatedAt } = await getCdfRate();
  assert.equal(cdfPerUsd, 2296.6, 'the August entry must not pin the rate forever');
  assert.equal(updatedAt, '2026-09-08');
});

test('a FRESH admin correction outranks the live feed', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => LIVE_PAYLOAD }));
  enqueue([{ cdf_per_usd: 2350, updated_at: '2026-09-08T12:00:00.000Z' }]);

  const { cdfPerUsd, updatedAt } = await getCdfRate();
  assert.equal(cdfPerUsd, 2350, 'a human correcting the same day wins');
  assert.equal(updatedAt, '2026-09-08');
});

test('DB down AND feed down still yields a usable dated rate, not a throw', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline');
  });
  enqueue([]);

  const { cdfPerUsd, updatedAt } = await getCdfRate();
  assert.equal(cdfPerUsd, DEFAULT_CDF_PER_USD);
  assert.equal(updatedAt, DEFAULT_RATE_UPDATED_AT);
});
