import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { AVAILABILITY_UNANSWERED_SQL, FILTERABLE_FLAGS, listModerationQueue } from '@/lib/moderationQueue';
import { QUALITY_FLAGS } from '@/lib/moderation';

/**
 * The admin side of the WhatsApp availability check: a listing whose last two
 * questions went unanswered is a moderation flag and a work-queue count.
 * The flag's SQL names listing_availability_checks, which only exists once its
 * migration has run — without that table the queue must still load.
 */

beforeEach(() => reset());

test('"availability unanswered" is a filterable quality flag with a label', () => {
  assert.ok(QUALITY_FLAGS.includes('availability_unanswered'));
  assert.ok(FILTERABLE_FLAGS.includes('availability_unanswered'));
});

test('unanswered means the last TWO WhatsApp questions, on a live listing nobody confirmed since', () => {
  const sql = AVAILABILITY_UNANSWERED_SQL.replace(/\s+/g, ' ');
  assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(sql, /ORDER BY c\.asked_at DESC LIMIT 2/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE last_two\.answered_at IS NULL\) = 2/);
  assert.match(sql, /c\.channel = 'WHATSAPP'/);
  assert.match(sql, /availability_confirmed_at/);
});

test('without the checks table the moderation queue still loads, with the flag simply false', async () => {
  enqueue([{ ok: false }]); // to_regclass: migration not run
  await listModerationQueue({ status: 'approved' });
  const queue = calls.find((c) => c.sql.includes('WITH base AS'));
  assert.ok(queue, 'the queue query ran');
  assert.match(queue.sql, /false AS availability_unanswered/);
  assert.ok(!queue.sql.includes('listing_availability_checks'), 'a missing table is never named');
});
