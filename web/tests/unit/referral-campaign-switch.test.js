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

test('the Campagne tab: in the sidebar, the switch for owners, the clearer message', async () => {
  const nav = read('lib/adminNav.js');
  assert.match(nav, /href: '\/admin\/campagne', labelKey: 'admin\.nav\.campaign'/);
  assert.match(read('lib/adminRoles.js'), /'\/admin\/campagne': 'partners\.view'/);
  const actions = read('app/admin/campagne/actions.js');
  assert.match(actions, /requireAdmin\('partners\.manage'\)[\s\S]*saveReferralCampaign[\s\S]*recordAudit/);
  const page = read('app/admin/campagne/page.js');
  assert.match(page, /canManage \? \(\s*<form action=\{setCampaignAction\}/);
  assert.match(page, /announcementText\(SAMPLE\)/);
  const { announcementText } = await import('@/lib/referralAnnouncement');
  const text = announcementText({ firstName: 'Charly', inviteLink: 'https://lukkaplace.com/i/CHARLY01' });
  assert.match(text, /^Bonjour Charly ! Lukka Place vous paie pour nous amener vos clients\./);
  assert.match(text, /Vous êtes déjà inscrit/);
  assert.doesNotMatch(text, /Nouveau sur Lukka Place/, 'the wording agents misread is gone');
});

test('while the campaign is off, an agent code is not a code: every check reads one SQL condition', async () => {
  const { FIND_PARTNER_BY_CODE_SQL, AGENT_CODES_LIVE_SQL } = await import('@/lib/partners');
  assert.ok(FIND_PARTNER_BY_CODE_SQL.includes(AGENT_CODES_LIVE_SQL));
  assert.match(AGENT_CODES_LIVE_SQL, /p\.kind <> 'agent' OR EXISTS/);
  assert.match(AGENT_CODES_LIVE_SQL, /s\.key = 'growth\.referral_campaign' AND \(s\.value ->> 'active'\) = 'true'/);
  // The engine's WhatsApp signup carries the same condition.
  const engine = readFileSync(new URL('../../../services/customerOnboarding.js', import.meta.url), 'utf8');
  assert.match(engine, /p\.kind <> 'agent' OR EXISTS \(\s*SELECT 1 FROM cms_settings s\s*WHERE s\.key = 'growth\.referral_campaign' AND \(s\.value ->> 'active'\) = 'true'\)/);
  // Every code check goes through findActivePartnerByCode / resolveCode, which use that SQL.
  for (const file of ['lib/partnerVisit.js', 'lib/partnerPrefill.js', 'lib/accountAcquisition.js', 'app/(site)/compte/inscription/actions.js', 'app/(site)/compte/agent/inscription/actions.js', 'app/(site)/i/[code]/actions.js']) {
    assert.match(read(file), /findActivePartnerByCode/, file);
  }
  assert.match(read('app/go/[code]/[[...rest]]/route.js'), /resolveCode/);
  assert.match(read('components/AgentReferralCard.js'), /if \(!\(await getReferralCampaign\(\)\)\.active\) return null;/);
});
