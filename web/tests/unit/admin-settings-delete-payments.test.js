import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { featuresFromStored, mergeSocialLinks, socialLinksFromStored, validateSocialUrl } from '@/lib/siteSettingsRules';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { SOFT_DELETE_MAX, UNDO_GRACE_MS, cleanIds, isBatchId, undoStillOpen } from '@/lib/adminSoftDeleteRules';
import { restoreBatch, softDelete } from '@/lib/adminSoftDelete';
import { listAgentsForAdmin } from '@/lib/agents';
import { listAgenciesForAdmin } from '@/lib/adminAgencies';
import { listModerationQueue } from '@/lib/moderationQueue';
import {
  invoiceReference, normaliseMobileMoneyPhone, readCheckResponse, readInitiateResponse, redactForLog,
} from '@/lib/flexpaieRules';
import { callbackTokenValid } from '@/lib/payments';
import { calls, enqueue, reset } from '../support/fakePool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

// ---------------------------------------------------------------------------
// /admin/settings — social links and feature flags
// ---------------------------------------------------------------------------

test('a social link must be https on that network’s own host', () => {
  assert.deepEqual(validateSocialUrl('facebook', ''), { ok: true, value: '' });
  assert.equal(validateSocialUrl('facebook', 'https://www.facebook.com/lukkaplace').ok, true);
  assert.equal(validateSocialUrl('facebook', 'http://www.facebook.com/lukkaplace').error, 'https');
  assert.equal(validateSocialUrl('facebook', 'https://facebook.com.evil.example/x').error, 'host');
  assert.equal(validateSocialUrl('instagram', 'https://www.facebook.com/lukkaplace').error, 'host');
  assert.equal(validateSocialUrl('tiktok', 'https://www.tiktok.com/').error, 'path');
  assert.equal(validateSocialUrl('tiktok', 'https://www.tiktok.com/@lukkaplace').ok, true);
  assert.equal(validateSocialUrl('whatsapp', 'https://wa.me/message/ABC123').ok, true);
  assert.equal(validateSocialUrl('whatsapp', 'javascript:alert(1)').error, 'https');
  assert.equal(validateSocialUrl('facebook', 'https://user:pw@facebook.com/x').error, 'invalid');
});

test('a stored value is re-validated on read, and the console beats the env', () => {
  assert.deepEqual(socialLinksFromStored({ facebook: 'https://evil.example/x', instagram: 'https://instagram.com/lp' }), {
    instagram: 'https://instagram.com/lp',
  });
  assert.deepEqual(mergeSocialLinks({ facebook: 'https://facebook.com/a' }, { facebook: 'https://facebook.com/env', instagram: 'https://instagram.com/env' }), {
    facebook: 'https://facebook.com/a',
    instagram: 'https://instagram.com/env',
  });
});

test('the Abonnements tab is hidden unless a flag says otherwise; projects stay on by default', () => {
  assert.equal(featuresFromStored(null).agentSubscriptions, false);
  assert.equal(featuresFromStored({ agentSubscriptions: 'yes' }).agentSubscriptions, false);
  assert.equal(featuresFromStored({ agentSubscriptions: true }).agentSubscriptions, true);
  assert.equal(featuresFromStored(null).publicProjects, true);
  assert.equal(featuresFromStored(null).agentProjects, true);
  assert.equal(featuresFromStored({ publicProjects: false }).publicProjects, false);
});

test('hidden console tabs: only known hrefs, never the settings page itself', () => {
  const stored = { hiddenAdminTabs: ['/admin/subscriptions', '/admin/projets', '/admin/settings', '/admin/gone', 'https://x', 7, '/admin/projets'] };
  assert.deepEqual(featuresFromStored(stored, ADMIN_NAV_HREFS).hiddenAdminTabs, ['/admin/subscriptions', '/admin/projets']);
  assert.deepEqual(featuresFromStored(null, ADMIN_NAV_HREFS).hiddenAdminTabs, []);
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/subscriptions') && ADMIN_NAV_HREFS.includes('/admin/projets'));
});

test('the sidebar, the save action and the settings form read one tab list', () => {
  const sidebar = read('app/admin/AdminSidebar.js');
  assert.match(sidebar, /ADMIN_NAV_GROUPS/);
  assert.match(sidebar, /!hiddenTabs\.includes\(href\)/);
  assert.doesNotMatch(sidebar, /href: '\/admin\/dashboard'/, 'the tab list lives in lib/adminNav.js only');
  assert.match(read('app/admin/layout.js'), /hiddenTabs=\{hiddenAdminTabs\}/);
  assert.match(read('app/admin/settings/actions.js'), /formData\.get\(`tab:\$\{href\}`\) !== 'on'/);
});

test('switching Projets neufs off reaches every public and agent entry point', () => {
  assert.match(read('app/(site)/projets/layout.js'), /publicProjects\) redirect\('\/listings'\)/);
  assert.match(read('app/(site)/promoteurs/layout.js'), /publicProjects\) redirect\('\/listings'\)/);
  assert.match(read('app/compte/agent/projets/layout.js'), /agentProjects\) redirect\('\/compte\/agent'\)/);
  assert.match(read('app/(site)/layout.js'), /hiddenHrefs=\{features\.publicProjects \? \[\] : \['\/projets'\]\}/);
  assert.match(read('components/Footer.js'), /\['\/projets', '\/promoteurs'\]/);
  assert.match(read('components/projects/NewProjectsStrip.js'), /publicProjects\) return null/);
  assert.match(read('components/projects/AgentProjectsCard.js'), /agentProjects\) return null/);
  assert.match(read('app/api/projects/count/route.js'), /publicProjects\) return NextResponse\.json\(\{ count: 0 \}\)/);
  assert.match(read('app/sitemap.js'), /publicProjects \|\| !PROJECT_PAGES\.includes/);
});

test('the hidden tab is gone from the nav, its page redirects, and limit prompts point at the team', () => {
  assert.match(read('components/AgentSidebar.js'), /featureKey: 'agentSubscriptions'/);
  assert.match(read('app/compte/agent/abonnement/page.js'), /agentSubscriptions\) redirect\('\/compte\/agent'\)/);
  assert.match(read('components/ListingLimitDialog.js'), /subscriptionsEnabled \? quota\?\.upgradeHref \|\| UPGRADE_PATH : CONTACT_PATH/);
  assert.match(read('app/compte/agent/biens/page.js'), /agentSubscriptions \? UPGRADE_PATH : CONTACT_PATH/);
});

test('the footer copyright carries no tagline in either language', () => {
  for (const locale of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${locale}.json`));
    assert.equal(dict.footer.copyright, '© {year} Lukka Place.');
  }
});

// ---------------------------------------------------------------------------
// Bulk soft delete
// ---------------------------------------------------------------------------

test('a selection is 1..100 positive ids, and undo has a grace window', () => {
  assert.deepEqual(cleanIds([3, '3', 4, -1, 'x']), [3, 4]);
  assert.equal(cleanIds([]), null);
  assert.equal(cleanIds(Array.from({ length: SOFT_DELETE_MAX + 1 }, (_, i) => i + 1)), null);
  const now = Date.now();
  assert.equal(undoStillOpen(new Date(now - 9_000), now), true);
  assert.equal(undoStillOpen(new Date(now - UNDO_GRACE_MS - 1), now), false);
  assert.equal(isBatchId('not-a-uuid'), false);
  assert.equal(isBatchId('0b6b2f2e-9f1c-4c39-8a4e-1d6d1a3f8e22'), true);
});

test('deleting an agent logs previous status and takes their listings off the site', async () => {
  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: '7', status: 1 }]); // lock agents
  enqueue([{ id: '70' }, { id: '71' }]); // their listings
  enqueue([{ id: '70', status: 1 }, { id: '71', status: 0 }]); // lock listings
  const result = await softDelete('agent', [7], 'Owner');
  assert.equal(result.deleted, 1);
  assert.equal(result.cascadedListings, 2);
  const sql = calls.map((c) => c.sql);
  assert.ok(sql.some((s) => s.startsWith('INSERT INTO console_soft_deletions') && s.includes('previous_status')));
  assert.ok(sql.some((s) => s.startsWith('UPDATE properties SET deleted_at = NOW(), deleted_by = $2, status = 0')));
  assert.ok(sql.some((s) => s.startsWith('UPDATE agents SET deleted_at = NOW(), deleted_by = $2, status = 0')));
  assert.ok(sql.includes('COMMIT'));
});

test('undo matches deleted_at inside SQL, never through a JS Date', async () => {
  reset();
  enqueue([]); // BEGIN
  enqueue([{ id: 1, entity_type: 'agent', entity_id: 7, previous_status: 1, deleted_at: new Date(), restored_at: null }]);
  const result = await restoreBatch('0b6b2f2e-9f1c-4c39-8a4e-1d6d1a3f8e22', 'Owner');
  assert.equal(result.ok, true);
  const updates = calls.filter((c) => /^UPDATE (properties|agents|vendors) t/.test(c.sql));
  assert.equal(updates.length, 3);
  for (const u of updates) {
    assert.ok(u.sql.includes('t.deleted_at = d.deleted_at'));
    assert.ok(!u.values.some((v) => v instanceof Date));
  }
});

test('undo is refused once the grace window has passed', async () => {
  reset();
  enqueue([]);
  enqueue([{ id: 1, entity_type: 'listing', entity_id: 9, previous_status: 1, deleted_at: new Date(Date.now() - UNDO_GRACE_MS - 5_000), restored_at: null }]);
  assert.deepEqual(await restoreBatch('0b6b2f2e-9f1c-4c39-8a4e-1d6d1a3f8e22', 'Owner'), { ok: false, reason: 'expired' });
});

test('console lists skip soft-deleted agents, agencies and listings', async () => {
  reset();
  await listAgentsForAdmin({});
  assert.ok(calls.every((c) => c.sql.includes('deleted_at IS NULL')), 'every agents-list query filters deleted rows');
  reset();
  await listAgenciesForAdmin({});
  assert.ok(calls.every((c) => c.sql.includes('v.deleted_at IS NULL')));
  reset();
  await listModerationQueue({ status: 'approved' });
  assert.ok(calls.filter((c) => c.sql.includes('WITH base AS')).every((c) => c.sql.includes('p.deleted_at IS NULL')));
});

// ---------------------------------------------------------------------------
// FlexPaie
// ---------------------------------------------------------------------------

test('only a DRC mobile number is a mobile-money number', () => {
  assert.equal(normaliseMobileMoneyPhone('0812345678'), '243812345678');
  assert.equal(normaliseMobileMoneyPhone('+243 97 123 4567'), '243971234567');
  assert.equal(normaliseMobileMoneyPhone('00243991234567'), '243991234567');
  assert.equal(normaliseMobileMoneyPhone('447932673460'), null);
  assert.equal(normaliseMobileMoneyPhone('243123'), null);
  assert.equal(invoiceReference(42, 2026, 'abcd99'), 'LP-2026-42-ABCD');
});

test('initiate is accepted only on code "0" with an order number', () => {
  assert.deepEqual(readInitiateResponse({ code: '0', orderNumber: 'ORD1' }), { ok: true, orderNumber: 'ORD1' });
  assert.equal(readInitiateResponse({ code: '1', message: 'bad merchant' }).ok, false);
  assert.equal(readInitiateResponse({ code: '0' }).ok, false);
});

test('only a status check with status "0" and a covering amount marks an invoice paid', () => {
  const invoice = { amount: '25.00', currency: 'USD', reference: 'LP-2026-1-AAAA' };
  const tx = (over) => ({ code: '0', transaction: { reference: 'LP-2026-1-AAAA', status: '0', amount: '25', currency: 'USD', ...over } });
  assert.equal(readCheckResponse(tx({}), invoice).state, 'paid');
  assert.equal(readCheckResponse(tx({ status: '1' }), invoice).state, 'failed');
  assert.equal(readCheckResponse(tx({ status: '2' }), invoice).state, 'pending');
  assert.equal(readCheckResponse(tx({ amount: '20' }), invoice).state, 'mismatch');
  assert.equal(readCheckResponse(tx({ currency: 'CDF' }), invoice).state, 'mismatch');
  assert.equal(readCheckResponse(tx({ reference: 'LP-2026-2-BBBB' }), invoice).state, 'mismatch');
  assert.equal(readCheckResponse({ code: '1' }, invoice).state, 'pending');
});

test('payment logs never keep a token or key', () => {
  assert.deepEqual(redactForLog({ a: 1, token: 'x', nested: { Authorization: 'Bearer y', ok: true } }), { a: 1, nested: { ok: true } });
});

test('a callback without its invoice token is rejected before any query', async () => {
  reset();
  assert.equal(await callbackTokenValid(5, ''), false);
  assert.equal(await callbackTokenValid(Number.NaN, 'a'.repeat(48)), false);
  assert.equal(calls.length, 0);
});

test('FlexPaie credentials are server-only', () => {
  const src = read('lib/flexpaie.js');
  assert.match(src, /^import 'server-only';/);
  assert.doesNotMatch(src, /NEXT_PUBLIC_FLEXPAIE/);
});
