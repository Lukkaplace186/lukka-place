import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { announceOnWrite, announceReferralProgram } from '@/lib/referralAnnouncement';
import { REFERRAL_CAMPAIGN_KEY, getReferralCampaign } from '@/lib/siteSettings';
import { forget } from '@/lib/memo';
import { calls, enqueue, reset } from '../support/fakePool.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

beforeEach(() => {
  reset();
  forget('site-settings:');
});

test('no stored switch reads as STOPPED (the campaign was stopped on 2026-11-04)', async () => {
  assert.equal(REFERRAL_CAMPAIGN_KEY, 'growth.referral_campaign');
  const campaign = await getReferralCampaign();
  assert.equal(campaign.active, false);
});

test('while stopped, neither the console button nor an agent writing in sends or records anything', async () => {
  const button = await announceReferralProgram();
  assert.equal(button.paused, true);
  assert.equal(button.accepted, 0);
  reset();
  forget('site-settings:');
  assert.deepEqual(await announceOnWrite({ agentId: 70 }), { status: 'paused' });
  assert.equal(calls.length, 1, 'only the switch was read');
  assert.match(calls[0].sql, /FROM cms_settings WHERE key = \$1/);
  assert.ok(!calls.some((c) => /partner_program_announcements/.test(c.sql)), 'nothing recorded');
});

test('an active switch lets the sends through to their own rules', async () => {
  enqueue([{ value: { active: true }, updated_at: '2026-11-04T10:00:00Z', updated_by: 'Owner' }]);
  const campaign = await getReferralCampaign();
  assert.deepEqual(campaign, { active: true, updatedAt: '2026-11-04T10:00:00Z', updatedBy: 'Owner' });
  enqueue([]); // the on-write agent lookup: not eligible
  assert.deepEqual(await announceOnWrite({ agentId: 70 }), { status: 'not-eligible' });
});

test('the console switch is owner-only, audited, and the page shows the state', () => {
  const actions = read('app/admin/partenaires/agents/actions.js');
  assert.match(actions, /export async function setReferralCampaignAction[\s\S]*requireAdmin\('partners\.manage'\)[\s\S]*saveReferralCampaign[\s\S]*recordAudit/);
  const page = read('app/admin/partenaires/agents/page.js');
  assert.match(page, /canAnnounce && campaign\.active \? \(\s*<form action=\{announceProgramAction\}/, 'no Annoncer button while stopped');
  assert.match(page, /setReferralCampaignAction/);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const key of ['active', 'stopped', 'changed', 'stop', 'start']) assert.ok(dict.admin.referrals.campaign[key], `${lang} ${key}`);
    for (const key of ['campaignStarted', 'campaignStopped', 'paused']) assert.ok(dict.admin.referrals.flash[key], `${lang} ${key}`);
  }
});
