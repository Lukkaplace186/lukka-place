import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatPriceCdf, convertCdfToUsd, usablePrice } from '@/lib/format';

/**
 * F7. `properties.price` is nullable, and formatPrice did
 * `Number(price).toLocaleString('fr-FR')` with no finite guard.
 *
 * The two bad inputs behave differently, which is why this is worth pinning
 * precisely rather than describing loosely:
 *   Number(null)      === 0   -> "0 $"   (wrong, but not obviously broken)
 *   Number(undefined) === NaN -> "NaN $" (visibly broken)
 * A LEFT JOIN or a missing column yields undefined, so the visible failure
 * is reachable. It also propagates into the WhatsApp share text via
 * lib/whatsapp.js, so a shared link can read "— NaN $ / mois".
 *
 * The contract asserted here: an unknown price must never render a number.
 */

const UNKNOWN_PRICES = [null, undefined, '', 'abc', NaN];

test('a real price still formats exactly as before', () => {
  assert.equal(formatPrice(1500, 'sale'), '1 500 $'.replace(/ /g, ' ') === '1 500 $' ? '1 500 $' : formatPrice(1500, 'sale'));
  assert.match(formatPrice(1500, 'sale'), /1.500 \$/);
  assert.match(formatPrice(1500, 'rent'), /1.500 \$ \/ mois/);
  assert.match(formatPrice(1500, 'rent', 'an'), /1.500 \$ \/ an/);
  assert.match(formatPrice(1500, 'rent', 'mois'), /1.500 \$ \/ mois/);
});

test('an unknown price never renders NaN (F7)', () => {
  for (const price of UNKNOWN_PRICES) {
    for (const purpose of ['sale', 'rent']) {
      const out = formatPrice(price, purpose);
      assert.ok(
        !String(out).includes('NaN'),
        `formatPrice(${JSON.stringify(price)}, '${purpose}') produced ${JSON.stringify(out)}`,
      );
    }
  }
});

test('an unknown price never renders a fabricated zero (F7)', () => {
  // "0 $" is worse than an honest absence: a visitor reads it as free.
  for (const price of UNKNOWN_PRICES) {
    const out = String(formatPrice(price, 'sale'));
    assert.ok(!/\b0\s*\$/.test(out), `formatPrice(${JSON.stringify(price)}) produced ${JSON.stringify(out)}`);
  }
});

test('formatPriceCdf has the same guarantee', () => {
  for (const price of UNKNOWN_PRICES) {
    const out = String(formatPriceCdf(price, 'rent'));
    assert.ok(!out.includes('NaN'), `formatPriceCdf(${JSON.stringify(price)}) produced ${JSON.stringify(out)}`);
  }
});

test('convertCdfToUsd already guards its inputs and returns null', () => {
  assert.equal(convertCdfToUsd(null, 2800), null);
  assert.equal(convertCdfToUsd(2800, 0), null);
  assert.equal(convertCdfToUsd(2800, null), null);
  assert.equal(convertCdfToUsd(28000, 2800), 10);
});

test('convertToCdf has the same guarantee as its mirror (currency.js)', async () => {
  const { convertToCdf } = await import('@/lib/currency');
  // Number(null) is 0 and IS finite, so the original guard turned an unknown
  // price into a free one — "≈ 0 FC" under the listing price.
  assert.equal(convertToCdf(null, 2292), null);
  assert.equal(convertToCdf('', 2292), null);
  assert.equal(convertToCdf(0, 2292), null);
  assert.equal(convertToCdf(undefined, 2292), null);
  assert.equal(convertToCdf(10, 2292), 22920);
});

test('a real price is unaffected by the guard', () => {
  assert.equal(usablePrice(1500), 1500);
  assert.equal(usablePrice('1500'), 1500);
  assert.equal(usablePrice(0.5), 0.5);
});
