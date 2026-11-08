import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { hashOtp } from '@/lib/authCrypto';
import { requestPhoneChange, confirmPhoneChange, getPendingPhoneChange } from '@/lib/customerPhoneChange';
import { PHONE_CHANGE_MAX_ATTEMPTS, PHONE_CHANGE_MAX_SENDS_PER_HOUR, phoneChangeCodeText } from '@/lib/customerPhoneChangeRules';

/**
 * "Changer de numéro" (2026-11-08): a signed-in customer moves the account to
 * a new number with a WhatsApp code sent to that new number. These pin the
 * rules: no code to an account's own or another account's number, a capped
 * send rate, a capped number of tries, the old number kept in history, every
 * other session ended, and requests/visits still read under old numbers.
 */

beforeEach(() => reset());

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const sqlOf = (pattern) => calls.find((call) => pattern.test(call.sql));

// --- step 1: asking for a code ----------------------------------------------------

test('an invalid number is refused before any query', async () => {
  assert.deepEqual(await requestPhoneChange(7, 'abc'), { ok: false, error: 'phone' });
  assert.equal(calls.length, 0);
});

test('the account’s own number is "same", not a code', async () => {
  enqueue([{ phone: '243990000001' }]);
  assert.deepEqual(await requestPhoneChange(7, '243990000001'), { ok: false, error: 'same' });
  assert.equal(calls.length, 1);
});

test('a number another account holds is "taken" and nothing is written', async () => {
  enqueue([{ phone: '243990000001' }]);
  enqueue([{ '?column?': 1 }]);
  assert.deepEqual(await requestPhoneChange(7, '243990000002'), { ok: false, error: 'taken' });
  assert.ok(sqlOf(/SELECT 1 FROM customers WHERE phone = \$1 AND id <> \$2/));
  assert.equal(sqlOf(/UPDATE customers/), undefined);
});

test('past the hourly cap the update matches nothing and the answer is "rate"', async () => {
  enqueue([{ phone: '243990000001' }]);
  enqueue([]);
  enqueue([]); // the guarded UPDATE: no row
  assert.deepEqual(await requestPhoneChange(7, '243990000002'), { ok: false, error: 'rate' });
  const update = sqlOf(/UPDATE customers SET phone_change_sends/);
  assert.ok(update, 'the counter and the pending change are one statement');
  assert.match(update.sql, /phone_change_sends < \$5/);
  assert.equal(update.values[4], PHONE_CHANGE_MAX_SENDS_PER_HOUR);
  assert.equal(update.values[1], '243990000002');
  assert.notEqual(update.values[2], null, 'only the code’s hash is stored');
  assert.doesNotMatch(String(update.values[2]), /^\d{6}$/);
});

test('before the migration the request says "unavailable", not an error page', async () => {
  enqueue([{ phone: '243990000001' }]);
  enqueue([]);
  const pool = (await import('../support/fakePool.js')).getPool();
  const original = pool.query;
  let n = 0;
  pool.query = async (text, values) => {
    n += 1;
    if (n === 3) throw Object.assign(new Error('column does not exist'), { code: '42703' });
    return original(text, values);
  };
  try {
    assert.deepEqual(await requestPhoneChange(7, '243990000002'), { ok: false, error: 'unavailable' });
  } finally {
    pool.query = original;
  }
});

test('the session-message text carries the code and no other number', () => {
  const text = phoneChangeCodeText('482913');
  assert.match(text, /482913/);
  assert.match(text, /10 minutes/);
});

// --- step 2: the code --------------------------------------------------------------

function pendingRow(overrides = {}) {
  return {
    phone: '243990000001',
    phone_change_to: '243990000002',
    phone_change_code_hash: hashOtp('123456'),
    phone_change_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    phone_change_attempts: 0,
    ...overrides,
  };
}

test('the right code moves the number, keeps the old one, confirms it and ends every session', async () => {
  enqueue([]); // BEGIN
  enqueue([pendingRow()]);
  enqueue([]); // history insert
  enqueue([{ phone: '243990000002', token_version: 4 }]);
  enqueue([]); // COMMIT
  const result = await confirmPhoneChange(7, '123456');
  assert.deepEqual(result, { ok: true, phone: '243990000002', previousPhone: '243990000001', tokenVersion: 4 });
  assert.match(sqlOf(/FROM customers WHERE id = \$1 FOR UPDATE/).sql, /FOR UPDATE/);
  const history = sqlOf(/INSERT INTO customer_phone_history/);
  assert.deepEqual(history.values, [7, '243990000001']);
  const update = sqlOf(/SET phone = phone_change_to/);
  assert.match(update.sql, /token_version = token_version \+ 1/);
  assert.match(update.sql, /phone_verified_at = NOW\(\)/);
  assert.match(update.sql, /phone_change_code_hash = NULL/);
  assert.match(update.sql, /reset_otp_code_hash = NULL/);
});

test('a wrong code counts one try and changes nothing', async () => {
  enqueue([]);
  enqueue([pendingRow()]);
  assert.deepEqual(await confirmPhoneChange(7, '000000'), { ok: false, error: 'invalid' });
  assert.ok(sqlOf(/phone_change_attempts = phone_change_attempts \+ 1/));
  assert.equal(sqlOf(/SET phone = phone_change_to/), undefined);
  assert.equal(sqlOf(/INSERT INTO customer_phone_history/), undefined);
});

test('the last allowed wrong code says "too many"; after it even the right code is refused', async () => {
  enqueue([]);
  enqueue([pendingRow({ phone_change_attempts: PHONE_CHANGE_MAX_ATTEMPTS - 1 })]);
  assert.deepEqual(await confirmPhoneChange(7, '000000'), { ok: false, error: 'too_many' });
  reset();
  enqueue([]);
  enqueue([pendingRow({ phone_change_attempts: PHONE_CHANGE_MAX_ATTEMPTS })]);
  assert.deepEqual(await confirmPhoneChange(7, '123456'), { ok: false, error: 'too_many' });
  assert.equal(sqlOf(/SET phone = phone_change_to/), undefined);
});

test('an expired code and no change in flight are refused', async () => {
  enqueue([]);
  enqueue([pendingRow({ phone_change_expires_at: new Date(Date.now() - 1000).toISOString() })]);
  assert.deepEqual(await confirmPhoneChange(7, '123456'), { ok: false, error: 'expired' });
  reset();
  enqueue([]);
  enqueue([pendingRow({ phone_change_to: null })]);
  assert.deepEqual(await confirmPhoneChange(7, '123456'), { ok: false, error: 'none' });
});

test('a pending change is shown only while its code is valid', async () => {
  enqueue([{ phone: '243990000002', expires_at: new Date(Date.now() + 60000).toISOString() }]);
  assert.equal((await getPendingPhoneChange(7)).phone, '243990000002');
  enqueue([{ phone: '243990000002', expires_at: new Date(Date.now() - 60000).toISOString() }]);
  assert.equal(await getPendingPhoneChange(7), null);
  assert.match(calls[0].sql, /to_jsonb\(c\) ->> 'phone_change_to'/, 'readable before the migration');
});

// --- wiring ------------------------------------------------------------------------

test('the actions take the customer from the session and keep this device signed in', () => {
  const src = read('app/(site)/compte/client/parametres/numero/actions.js');
  assert.match(src, /getCurrentCustomerId\(\)/);
  assert.doesNotMatch(src, /formData\.get\('customerId'\)/);
  assert.match(src, /establishCustomerSession\(\{ id: customerId, tokenVersion: result\.tokenVersion \}\)/);
  assert.match(src, /rememberCustomerPhone\(result\.phone\)/);
  assert.match(src, /redirect\('\/compte\/client\/parametres\?numero=change'\)/);
});

test('Paramètres links the number to the change page and says the new number after it', () => {
  const src = read('app/(site)/compte/client/parametres/page.js');
  assert.match(src, /href="\/compte\/client\/parametres\/numero"/);
  assert.match(src, /account\.phoneChange\.done/);
});

test('requests, visits and counts are read under every number the account has held', () => {
  assert.match(read('lib/customerInquiries.js'), /getAccountPhones\(customerId, customer\.phone\)/);
  assert.match(read('lib/customerPortal.js'), /getLeadCountsByWaIds\(phones\)/);
  const actions = read('app/(site)/compte/client/actions.js');
  assert.match(actions, /accountPhones\.includes\(lead\.wa_id\)/);
  assert.match(actions, /if \(error\?\.status !== 404\) throw error;/, 'only "not this number" tries the next one');
  assert.doesNotMatch(actions, /requireCustomerPhone\(\)/);
});

test('the migration is additive, keeps history per customer and closes the new table', () => {
  const sql = read('../migrations/20261108_customer_phone_change.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS phone_change_to/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer_phone_history/);
  assert.match(sql, /REFERENCES customers \(id\) ON DELETE CASCADE/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON customer_phone_history FROM anon, authenticated/);
});
