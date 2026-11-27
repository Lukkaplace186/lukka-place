import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  AGENT_CODES_LIVE_SQL, AGENT_PARTNER_AGENCY_SQL, FIND_PARTNER_BY_CODE_SQL, PARTNER_VENDOR_SQL,
  ensureAgencyPartnerCode, ensureAgentPartnerCode, findActivePartnerByCode, getAgentReferralStats,
} from '@/lib/partners';
import { AGENT_LEDGER_SQL, CREDIT_CANDIDATES_SQL, getAgentCreditSummary } from '@/lib/referralCredits';
import { PARTNER_KINDS, PARTNER_UTM_SOURCE, taggedDestination } from '@/lib/partnerRules';
import { channelOf } from '@/lib/growthRules';

/**
 * Agency referral codes (owner, 2026-11-16): JOKER AGENCY's partnership pays
 * $1 per customer, counted for the agency as a whole — the owner and every
 * agent share one code and one total.
 */

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const squash = (sql) => String(sql).replace(/\s+/g, ' ').trim();

beforeEach(() => reset());

test('an agent of a partner agency carries the AGENCY code, never a code of their own', async () => {
  enqueue([{ vendor_id: '1024' }]); // the agent's agency is a live partner
  enqueue([{ code: 'JOKER01' }]); // the agency already has its code
  assert.equal(await ensureAgentPartnerCode(125), 'JOKER01');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, AGENT_PARTNER_AGENCY_SQL);
  assert.deepEqual(calls[0].values, [125]);
  assert.match(calls[1].sql, /SELECT code FROM partners WHERE vendor_id = \$1/);
  assert.ok(!calls.some((c) => /INSERT INTO partners/.test(c.sql)), 'no personal code minted');
});

test('an agent outside a partner agency keeps their own code', async () => {
  enqueue([]); // not in a partner agency
  enqueue([{ code: 'MARIE01' }]);
  assert.equal(await ensureAgentPartnerCode(70), 'MARIE01');
  assert.match(calls[1].sql, /SELECT code FROM partners WHERE agent_id = \$1/);
});

test('the partner-agency lookup needs the agency marked, alive, and the agent alive', () => {
  const sql = squash(AGENT_PARTNER_AGENCY_SQL);
  assert.match(sql, /JOIN partner_agencies pag ON pag\.vendor_id = a\.vendor_id/);
  assert.match(sql, /v\.deleted_at IS NULL/);
  assert.match(sql, /a\.deleted_at IS NULL/);
});

test('an agency code is minted once from the agency name, as kind agency', async () => {
  enqueue([]); // no code yet
  enqueue([{ name: 'JOKER AGENCY' }]); // marked partner, not deleted
  enqueue([]); // no JOKER__ code taken
  enqueue([{ code: 'JOKER01' }]); // inserted
  assert.equal(await ensureAgencyPartnerCode(1024), 'JOKER01');
  assert.match(calls[1].sql, /JOIN partner_agencies pag ON pag\.vendor_id = v\.id WHERE v\.id = \$1 AND v\.deleted_at IS NULL/);
  const insert = calls[3];
  assert.match(insert.sql, /INSERT INTO partners \(kind, code, name, vendor_id\) VALUES \('agency', \$1, \$2, \$3\) ON CONFLICT \(vendor_id\) WHERE vendor_id IS NOT NULL DO NOTHING/);
  assert.deepEqual(insert.values, ['JOKER01', 'JOKER AGENCY', 1024]);
});

test('an agency not marked partner (or deleted) gets no code', async () => {
  enqueue([]);
  enqueue([]);
  assert.equal(await ensureAgencyPartnerCode(1024), null);
  assert.ok(!calls.some((c) => /INSERT/.test(c.sql)));
  assert.equal(await ensureAgencyPartnerCode('x'), null);
});

test('an agency code is live while the agency is a partner, whatever the agents\' campaign switch says', async () => {
  const live = squash(AGENT_CODES_LIVE_SQL);
  assert.match(live, /p\.kind = 'agent' AND EXISTS \( SELECT 1 FROM cms_settings s/);
  assert.match(live, /p\.kind = 'agency' AND EXISTS \( SELECT 1 FROM partner_agencies pag JOIN vendors pv ON pv\.id = pag\.vendor_id WHERE pag\.vendor_id = \(to_jsonb\(p\) ->> 'vendor_id'\)::bigint AND pv\.deleted_at IS NULL\)/);
  // Read through to_jsonb: the SQL parses before migrations/20261116_agency_partner_codes.sql.
  assert.equal(PARTNER_VENDOR_SQL, `(to_jsonb(p) ->> 'vendor_id')::bigint`);
  assert.ok(!/\bp\.vendor_id\b/.test(FIND_PARTNER_BY_CODE_SQL));
  enqueue([{ id: '90', kind: 'agency', code: 'JOKER01', name: 'JOKER AGENCY', agent_id: null, vendor_id: '1024', status: 'active' }]);
  const partner = await findActivePartnerByCode('joker01');
  assert.equal(partner.kind, 'agency');
  assert.equal(partner.vendorId, 1024);
  assert.equal(partner.agentId, null);
});

test('agency customers earn the $1 credit and are paid as one ledger row', () => {
  assert.match(squash(CREDIT_CANDIDATES_SQL), /JOIN partners p ON p\.id = c\.partner_id AND p\.kind IN \('agent', 'agency'\)/);
  assert.ok(CREDIT_CANDIDATES_SQL.includes(AGENT_CODES_LIVE_SQL));
  assert.match(squash(AGENT_LEDGER_SQL), /WHERE p\.kind IN \('agent', 'agency'\)/);
  assert.match(squash(AGENT_LEDGER_SQL), /SELECT p\.id, p\.kind, p\.code/);
});

test('the agent card shows the agency\'s figures and money, by the code the agent carries', async () => {
  enqueue([{ vendor_id: '1024' }]);
  enqueue([{ code: 'JOKER01' }]);
  enqueue([{ kind: 'agency', name: 'JOKER AGENCY', clicks: 9, clicks_30d: 4, accounts: 3, verified: 2 }]);
  const stats = await getAgentReferralStats(107);
  assert.deepEqual(stats, { code: 'JOKER01', scope: 'agency', agencyName: 'JOKER AGENCY', clicks: 9, clicks30d: 4, accounts: 3, verified: 2 });
  assert.match(calls[2].sql, /WHERE p\.code = \$1/);
  assert.deepEqual(calls[2].values, ['JOKER01']);

  reset();
  enqueue([{ vendor_id: '1024' }]);
  enqueue([{ code: 'JOKER01' }]);
  enqueue([
    { status: 'pending', amount: '1.00', currency: 'USD', created_at: '2026-11-16T10:00:00Z', first_name: 'Grace' },
    { status: 'paid', amount: '1.00', currency: 'USD', created_at: '2026-11-15T10:00:00Z', first_name: 'Paul' },
  ]);
  const credits = await getAgentCreditSummary(125);
  assert.equal(credits.activated, 2);
  assert.equal(credits.pendingUsd, 1);
  assert.equal(credits.paidUsd, 1);
  assert.match(calls[2].sql, /JOIN partners p ON p\.id = pc\.partner_id AND p\.code = \$1/);
  assert.deepEqual(calls[2].values, ['JOKER01']);
});

test('the card stays up for a partner agency while the agents\' campaign is stopped', () => {
  const card = read('components/AgentReferralCard.js');
  assert.match(card, /if \(stats\.scope !== 'agency' && !\(await getReferralCampaign\(\)\)\.active\) return null;/);
  assert.match(card, /agent\.referrals\.agencyShared/);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const key of ['agencyCode', 'agencyShared', 'yourAgency']) assert.ok(dict.agent.referrals[key], `${lang} agent.referrals.${key}`);
    for (const key of ['code', 'codeStats']) assert.ok(dict.admin.agencies.partner[key], `${lang} admin.agencies.partner.${key}`);
    for (const key of ['agency', 'agencyOne']) assert.ok(dict.admin.partners.types[key], `${lang} admin.partners.types.${key}`);
  }
});

test('the console: the agency page shows its code, /admin/partenaires has an Agences tab', () => {
  const agency = read('app/admin/agencies/[id]/page.js');
  assert.match(agency, /partner \? await getAgencyPartner\(agency\.id\)/);
  assert.match(agency, /\/admin\/partenaires\/\$\{agencyReferral\.id\}/);
  assert.match(read('app/admin/partenaires/page.js'), /\{ key: 'agences', kind: 'agency', labelKey: 'admin\.partners\.types\.agency' \}/);
  assert.match(read('app/admin/partenaires/[id]/page.js'), /partner\.kind !== 'agent' && partner\.kind !== 'agency'/, 'no fee form for an agency: it earns credits');
});

test('kind, link tags and the growth channel know the agency', () => {
  assert.ok(PARTNER_KINDS.includes('agency'));
  assert.equal(PARTNER_UTM_SOURCE.agency, 'agence');
  assert.match(taggedDestination('/', { kind: 'agency', code: 'JOKER01' }), /utm_source=agence&utm_medium=partner&utm_content=joker01/);
  assert.equal(channelOf({ partnerKind: 'agency', hasAcquisition: true }), 'agents');
});

test('the migration is idempotent and keeps an agency partner tied to its agency', () => {
  const sql = readFileSync(new URL('../../../migrations/20261116_agency_partner_codes.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS vendor_id bigint/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS partners_kind_check/);
  assert.match(sql, /CHECK \(kind IN \('agent', 'creator', 'campaign', 'agency'\)\)/);
  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'partners_agency_kind'/);
  assert.match(sql, /CHECK \(\(kind = 'agency'\) = \(vendor_id IS NOT NULL\)\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS partners_vendor_idx ON partners \(vendor_id\) WHERE vendor_id IS NOT NULL/);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
});
