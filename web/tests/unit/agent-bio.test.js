import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { updateAgentIdentity } from '@/lib/agencies';

/**
 * The agent's "Présentation" (Paramètres) is the AGENT's own text, on
 * agent_infos.details. It used to go to vendor_infos only when the account had
 * a vendor — and a self-signup account starts with vendor_id NULL, so the
 * description was dropped while the form said "Enregistré" (reported
 * 2026-10-23).
 */

beforeEach(reset);

const infoWrites = () => calls.filter((c) => /agent_infos/.test(c.sql));

test('a description is saved for an agent with no agency', async () => {
  enqueue([{}]); // the UPDATE finds the French row
  await updateAgentIdentity(7, { firstName: 'Marie', lastName: 'Nsumbu', bio: '  Agence à Gombe depuis 2015.  ' });
  const [update] = infoWrites();
  assert.match(update.sql, /UPDATE agent_infos SET .*details = CASE WHEN \$5 THEN \$6 ELSE details END/);
  assert.deepEqual(update.values.slice(4), [true, 'Agence à Gombe depuis 2015.']);
  assert.ok(!calls.some((c) => /vendor_infos/.test(c.sql)), 'never written to the agency any more');
});

test('a first save inserts the row with the description', async () => {
  await updateAgentIdentity(7, { firstName: 'Marie', bio: 'Bonjour' }); // UPDATE matches nothing
  const insert = infoWrites().find((c) => /INSERT INTO agent_infos/.test(c.sql));
  assert.match(insert.sql, /details/);
  assert.equal(insert.values[4], 'Bonjour');
});

test('clearing it stores an empty string, not NULL (no fallback to an old agency text)', async () => {
  enqueue([{}]);
  await updateAgentIdentity(7, { firstName: 'Marie', bio: '' });
  assert.deepEqual(infoWrites()[0].values.slice(4), [true, '']);
});

test('signup and the admin name edit leave the description alone', async () => {
  enqueue([{}]);
  await updateAgentIdentity(7, { firstName: 'Marie', lastName: null });
  assert.equal(infoWrites()[0].values[4], false);
});
