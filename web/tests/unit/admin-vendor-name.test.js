import test from 'node:test';
import assert from 'node:assert/strict';
import { vendorNameSql } from '@/lib/vendorName';
import { listAgenciesForAdmin } from '@/lib/adminAgencies';
import { listMembershipsForAdmin, getMembershipReceipt } from '@/lib/adminBilling';
import { getVendors, listAgentsForAdmin } from '@/lib/agents';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * `vendors.username` holds the phone digits for every agency created through
 * WhatsApp onboarding or phone signup. It reached the agencies directory, the
 * billing ledger and a printed receipt as the agency's "name". These pin that
 * every console read of an agency's name goes through vendorNameSql.
 */

test.beforeEach(() => reset());

test('a phone-shaped username is never the name; the agents\' own agency name, then the id, stand in', () => {
  const sql = vendorNameSql('v');
  assert.ok(sql.includes("CASE WHEN v.username ~ '^[+]?[0-9]{7,15}$' THEN NULL"), 'same phone rule as AGENCY_NAME_EXPR');
  assert.ok(sql.includes('FROM agents vn'));
  assert.ok(sql.includes("'Agence #' || v.id"));
  assert.ok(vendorNameSql('x').includes('x.username'), 'the alias is honoured');
});

test('the agencies directory selects, sorts and searches by the resolved name', async () => {
  await listAgenciesForAdmin({ q: 'Immo', sort: 'name' });
  const page = calls.find((c) => /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
  assert.ok(page.sql.includes(`${vendorNameSql('v').replace(/\s+/g, ' ')} AS name`));
  assert.ok(page.sql.includes(`ORDER BY LOWER(${vendorNameSql('v').replace(/\s+/g, ' ')}) ASC`));
  assert.ok(page.sql.includes('an.agency_name ILIKE'), 'an agency is findable by the name its agents gave it');
});

test('billing, receipts, the vendor picker and the agent table all use it', async () => {
  const expr = vendorNameSql('v').replace(/\s+/g, ' ');
  await listMembershipsForAdmin({ view: 'all' });
  assert.ok(calls.some((c) => c.sql.includes(`${expr} AS agency_name`)));

  reset();
  enqueue([]);
  await getMembershipReceipt(42);
  assert.ok(calls[0].sql.includes(`${expr} AS agency_name`));

  reset();
  await getVendors();
  assert.ok(calls[0].sql.includes(`${expr} AS name`));

  reset();
  await listAgentsForAdmin({});
  const page = calls.find((c) => /LIMIT \$\d+ OFFSET \$\d+$/.test(c.sql));
  assert.ok(page.sql.includes(`${expr} AS vendor_name`));
  assert.ok(!/NULLIF\(v\.username, ''\)/.test(page.sql), 'an agent with no name must not be displayed as their agency\'s phone digits');
});
