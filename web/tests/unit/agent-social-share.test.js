import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import {
  AGENT_BIO_SOURCE, SHARE_SOURCES, agentPageLabel, agentPageUrl, buildListingSocialCopy,
} from '@/lib/listingShareCopy';

/**
 * Agents' social posts lead back to their own page on Lukka Place
 * (2026-10-27): a direct "Publier sur les réseaux sociaux" entry in Mes biens,
 * the 4:5 card's caption naming the agent's page, and the page link for their
 * Instagram / TikTok bio, all carrying the agent's code.
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

const LISTING = {
  id: 387, price: 1800, purpose: 'rent', price_period: 'mois', beds: 3, bath: 2, area: '0',
  quartier: 'GB / Hôtel Diplomate', commune: 'Ngaliema', reference: null, deposit_months: 3,
};

test('agent page: /agents/<id> with its source and the agent’s code, a plain label to show', () => {
  assert.equal(agentPageUrl(37), 'https://lukkaplace.com/agents/37');
  assert.equal(
    agentPageUrl(37, { source: AGENT_BIO_SOURCE, ref: 'marie01' }),
    'https://lukkaplace.com/agents/37?utm_source=bio_agent&ref=MARIE01',
  );
  assert.equal(agentPageLabel(37), 'lukkaplace.com/agents/37');
  for (const bad of [null, 0, -3, 'x', 1.5]) {
    assert.equal(agentPageUrl(bad), null, String(bad));
    assert.equal(agentPageLabel(bad), null, String(bad));
  }
});

test('social caption: the listing first, then "Tous mes biens" on the agent’s page; WhatsApp captions unchanged', () => {
  const page = agentPageUrl(37, { source: SHARE_SOURCES.social, ref: 'MARIE01' });
  const url = 'https://lukkaplace.com/listings/387?utm_source=reseaux_sociaux&ref=MARIE01';
  const social = buildListingSocialCopy(LISTING, { typeText: 'Appartement', url, style: 'social', agentPage: page });
  const listingAt = social.indexOf(url);
  const pageAt = social.indexOf(`Tous mes biens sur Lukka Place :\n${page}`);
  assert.ok(listingAt > 0 && pageAt > listingAt, social);
  assert.ok(social.indexOf('#LukkaPlace') > pageAt, 'hashtags stay last');

  const whatsapp = buildListingSocialCopy(LISTING, { typeText: 'Appartement', url, agentPage: page });
  assert.doesNotMatch(whatsapp, /Tous mes biens/, 'only the social style names the page');
  assert.doesNotMatch(buildListingSocialCopy(LISTING, { typeText: 'Appartement', url, style: 'social' }), /Tous mes biens/);
});

test('the kit: agentPage for an agent (with their id and code), none for the team', () => {
  const kit = read('lib/marketing/shareKit.js');
  assert.match(kit, /const pageLabel = audience === 'agent' \? agentPageLabel\(agentId\) : null;/);
  assert.match(kit, /url: agentPageUrl\(agentId, \{ source: AGENT_BIO_SOURCE, ref \}\)/);
  assert.match(kit, /agentPage: channel === 'social' && agentPage \? agentPageUrl\(agentId, \{ source, ref \}\) : null/);
  // \r?: a Windows checkout (core.autocrlf) or a VPS copy may hold CRLF.
  assert.match(kit, /\r?\n    agentPage,\r?\n/);
  const actions = read('app/compte/agent/shareActions.js');
  assert.match(actions, /buildShareKit\(listing, \{ refCode: await ensureAgentPartnerCode\(agentId\), agentId \}\)/);
  assert.match(actions, /buildShareKit\(listing, \{ refCode, agentId \}\)/);
  assert.doesNotMatch(read('app/admin/listings/shareActions.js'), /agentId/, 'the team kit names no agent page');
});

test('Mes biens: "Publier sur les réseaux sociaux" opens the share dialog on the 4:5', () => {
  const menu = read('components/AgentListingActionsMenu.js');
  assert.match(menu, /key: 'social', Icon: Share2, label: t\('agent\.listings\.shareSocial'\), onSelect: \(\) => openQuickShare\('feed'\)/);
  assert.match(menu, /!shareBlocker\(listing\) && \{ key: 'social'/, 'live listings only, like the WhatsApp share');
  assert.match(menu, /key=\{quickShareFormat\}/);
  assert.match(menu, /initialFormat=\{quickShareFormat\}/);

  const quick = read('components/ListingQuickShare.js');
  assert.match(quick, /const startFormat = formats\.includes\(initialFormat\) \? initialFormat : formats\[0\];/);
  assert.match(quick, /\{feed && !team && kit\?\.agentPage \? \(/);
  assert.match(quick, /writeText\(url\)/);

  const en = JSON.parse(read('lib/i18n/en.json'));
  for (const messages of [fr, en]) {
    assert.ok(messages.agent.listings.shareSocial);
    for (const key of ['myPageTitle', 'myPageHint', 'myPageCopy', 'myPageCopied', 'myPageCopyFailed']) {
      assert.ok(messages.agent.quickShare[key], key);
    }
  }
});
