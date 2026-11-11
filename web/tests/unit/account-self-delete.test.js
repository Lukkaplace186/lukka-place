import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { deleteAgentAccount } from '@/lib/adminAgentDeletion';
import { deleteCustomer } from '@/lib/customers';
import { forgetPushAccount } from '@/lib/pushNotifications';

/**
 * Deleting an account from inside the app (2026-11-11): Google Play and the
 * App Store both require it. Agents delete their own account from Réglages
 * (owner decision: the admin's default delete — listings archived, never
 * deleted); customers already could. Either way the app's phones, inbox and
 * alert settings go with the account, because those three tables have no
 * foreign key to agents or customers.
 */

beforeEach(() => reset());

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const PUSH_TABLES = ['push_devices', 'notifications', 'notification_preferences'];

test('deleting an agent removes their phones, inbox and alert settings before the agent row', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 7, phone: '243' }]); // SELECT … FOR UPDATE
  enqueue([{ n: 0 }]); // no open commission
  enqueue([]); // documents
  const result = await deleteAgentAccount(7, { dryRun: true });
  assert.equal(result.ok, true);
  const agentRow = calls.findIndex((call) => /DELETE FROM agents WHERE id/.test(call.sql));
  for (const table of PUSH_TABLES) {
    const index = calls.findIndex((call) => new RegExp(`DELETE FROM ${table} WHERE user_type = \\$1 AND user_id = \\$2`).test(call.sql));
    assert.ok(index >= 0, table);
    assert.ok(index < agentRow, `${table} before the agent row`);
    assert.deepEqual(calls[index].values, ['agent', 7]);
  }
});

test('deleting a customer clears their app data and the customer in one transaction', async () => {
  await deleteCustomer(12);
  const sql = calls.map((call) => call.sql.trim());
  assert.equal(sql[0], 'BEGIN');
  assert.equal(sql.at(-1), 'COMMIT');
  for (const table of PUSH_TABLES) {
    const call = calls.find((c) => c.sql.includes(`DELETE FROM ${table}`));
    assert.ok(call, table);
    assert.deepEqual(call.values, ['customer', 12]);
  }
  assert.ok(sql.some((s) => /DELETE FROM customers WHERE id = \$1/.test(s)));
});

test('a database without the push tables still deletes the account', async () => {
  const missing = Object.assign(new Error('relation "push_devices" does not exist'), { code: '42P01' });
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (/DELETE FROM/.test(sql)) throw missing;
      return { rows: [], rowCount: 0 };
    },
  };
  assert.equal(await forgetPushAccount(client, 'agent', 3), 0);
  assert.equal(statements.filter((s) => s === 'ROLLBACK TO SAVEPOINT forget_push').length, 3);
});

test('any other database error is not swallowed', async () => {
  const client = {
    async query(sql) {
      if (/DELETE FROM/.test(sql)) throw Object.assign(new Error('deadlock'), { code: '40P01' });
      return { rows: [], rowCount: 0 };
    },
  };
  await assert.rejects(forgetPushAccount(client, 'customer', 3), /deadlock/);
});

test('the agent action deletes the session agent, archives listings and asks for SUPPRIMER', () => {
  const source = read('app/compte/agent/actions.js');
  const action = source.slice(source.indexOf('export async function deleteOwnAgentAccountAction'));
  const body = action.slice(0, action.indexOf('\n}\n'));
  assert.match(body, /const agentId = await assertAgentSession\(\)/, 'id from the session, never the form');
  assert.match(body, /deleteAgentAccount\(agentId, \{ listings: 'archive' \}\)/);
  assert.match(body, /DELETE_CONFIRM_WORD/);
  assert.match(body, /delete_commissions/);
  assert.match(body, /clearAgentSession\(\)/);
  assert.match(body, /forgetRememberedAgentPhone\(\)/);
  assert.match(source, /const DELETE_CONFIRM_WORD = 'SUPPRIMER'/);
});

test('Réglages offers the delete section, on a phone and on a computer', () => {
  const page = read('app/compte/agent/parametres/page.js');
  assert.match(page, /key: 'delete-account'/);
  assert.match(page, /<AgentDeleteAccountButton action=\{deleteOwnAgentAccountAction\}/);
  assert.match(page, /DELETE_ERROR_KEYS\[params\.error\]\) return 'delete-account'/, 'a refusal reopens the delete card');
  const dialog = read('components/AgentDeleteAccountButton.js');
  assert.match(dialog, /disabled=\{!confirmed\}/);
  assert.match(dialog, /name="confirm"/);
});

test('both dictionaries carry the delete wording', () => {
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    const keys = dict.agent.deleteAccount;
    for (const key of ['title', 'hint', 'button', 'confirmTitle', 'confirmBody', 'typeToConfirm', 'errorConfirm', 'errorCommissions', 'done']) {
      assert.equal(typeof keys[key], 'string', `${lang} ${key}`);
    }
    assert.match(keys.confirmBodyListings.other, /\{count\}/, lang);
  }
});
