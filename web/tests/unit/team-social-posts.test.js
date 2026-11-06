import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calls, enqueue, reset, normalizeSql } from '../support/fakePool.js';
import { TEAM_SOCIAL_SOURCE, listingPublicUrl } from '@/lib/listingShareCopy';
import {
  TEAM_SOCIAL_TARGETS, TEAM_SOCIAL_UTM_SOURCE, TARGET_KEY_PATTERN, captionForTarget, resolveTeamSocialTarget,
  targetSlug, teamSocialUrl,
} from '@/lib/teamSocialTargets';
import {
  getTeamSocialPostsByListing, recordTeamSocialPost, resetTeamSocialPostsCache,
} from '@/lib/teamSocialPosts';
import { listModerationQueue } from '@/lib/moderationQueue';

// Where Lukka Place posted each listing (2026-11-06): team_social_posts,
// lib/teamSocialTargets.js, lib/teamSocialPosts.js, /admin/listings.

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

beforeEach(() => {
  reset();
  resetTeamSocialPostsCache();
});

test('the client-safe utm_source is the share kit’s TEAM_SOCIAL_SOURCE', () => {
  assert.equal(TEAM_SOCIAL_UTM_SOURCE, TEAM_SOCIAL_SOURCE);
});

test('a place’s link is listingPublicUrl with the team source, the medium and the place as campaign', () => {
  assert.equal(teamSocialUrl(596, null), listingPublicUrl(596, { source: TEAM_SOCIAL_SOURCE }));
  const ndaku = resolveTeamSocialTarget({ key: 'immobilier-ndaku' });
  assert.equal(
    teamSocialUrl(596, ndaku),
    listingPublicUrl(596, { source: TEAM_SOCIAL_SOURCE, medium: 'groupe', campaign: 'immobilier-ndaku' }),
  );
  const page = resolveTeamSocialTarget({ key: 'page-facebook' });
  assert.equal(teamSocialUrl(596, page), listingPublicUrl(596, { source: TEAM_SOCIAL_SOURCE, medium: 'page', campaign: 'page-facebook' }));
  assert.equal(teamSocialUrl('x', ndaku), null);
});

test('listed places have unique, valid keys, and every group a facebook.com/groups link', () => {
  const keys = TEAM_SOCIAL_TARGETS.map((target) => target.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const target of TEAM_SOCIAL_TARGETS) {
    assert.match(target.key, TARGET_KEY_PATTERN);
    assert.ok(target.label.length <= 120);
    if (target.kind === 'group') assert.match(target.url, /^https:\/\/www\.facebook\.com\/groups\/[\w.]+\/$/);
  }
});

test('a typed place gets a slug; a typed listed name lands on the listed place; the browser never names a listed one', () => {
  assert.equal(targetSlug('Kin Apartéments (Gombe)'), 'kin-apartements-gombe');
  assert.equal(targetSlug('  ¡¿  '), null);
  assert.deepEqual(resolveTeamSocialTarget({ label: 'Kin Apartéments (Gombe)' }), { key: 'kin-apartements-gombe', label: 'Kin Apartéments (Gombe)', kind: 'other' });
  assert.equal(resolveTeamSocialTarget({ label: 'immobilier NDAKU' }).key, 'immobilier-ndaku');
  assert.equal(resolveTeamSocialTarget({ key: 'immobilier-ndaku', label: 'anything' }).label, 'Immobilier Ndaku');
  assert.equal(resolveTeamSocialTarget({}), null);
  assert.equal(resolveTeamSocialTarget({ label: '   ' }), null);
});

test('the caption’s link is swapped for the place’s link, and nothing else changes', () => {
  const kitUrl = listingPublicUrl(596, { source: TEAM_SOCIAL_SOURCE });
  const caption = `À LOUER · Appartement\n\nPhotos ↓\n${kitUrl}\n\n#kinshasa`;
  const target = resolveTeamSocialTarget({ key: 'immobilier-ndaku' });
  const out = captionForTarget(caption, kitUrl, 596, target);
  assert.equal(out, caption.replace(kitUrl, teamSocialUrl(596, target)));
  assert.equal(captionForTarget(caption, 'https://other', 596, target), caption);
});

test('recording a post checks the table, refuses a double mark, and inserts only a PUBLIC listing', async () => {
  enqueue([{ ok: true }]); // to_regclass
  enqueue([]); // no earlier post in the window
  enqueue([{ id: 1, property_id: 596, target_key: 'immobilier-ndaku', target_label: 'Immobilier Ndaku', posted_at: '2026-11-06T14:51:00Z', posted_by_label: 'Henoc' }]);
  const target = resolveTeamSocialTarget({ key: 'immobilier-ndaku' });
  const result = await recordTeamSocialPost({ propertyId: 596, target, session: { id: 3, name: 'Henoc' } });
  assert.equal(result.ok, true);
  assert.equal(result.post.targetKey, 'immobilier-ndaku');
  const insert = normalizeSql(calls[2].text);
  assert.match(insert, /INSERT INTO team_social_posts/);
  assert.match(insert, /p\.status = 1 AND p\.approve_status = 1/);
  assert.deepEqual(calls[2].values, [596, 'immobilier-ndaku', 'Immobilier Ndaku', 3, 'Henoc']);
});

test('the same place within the window answers duplicate without inserting', async () => {
  enqueue([{ ok: true }]);
  enqueue([{ id: 9, property_id: 596, target_key: 'immobilier-ndaku', target_label: 'Immobilier Ndaku', posted_at: '2026-11-06T14:51:00Z', posted_by_label: null }]);
  const result = await recordTeamSocialPost({ propertyId: 596, target: resolveTeamSocialTarget({ key: 'immobilier-ndaku' }), session: null });
  assert.equal(result.reason, 'duplicate');
  assert.equal(calls.length, 2);
});

test('before the migration: writes answer not_ready, reads answer null (unknown), the queue ignores the filters', async () => {
  enqueue([{ ok: false }]);
  const write = await recordTeamSocialPost({ propertyId: 596, target: resolveTeamSocialTarget({ key: 'instagram' }), session: null });
  assert.equal(write.reason, 'not_ready');
  assert.equal(await getTeamSocialPostsByListing([596]), null);
  reset();
  await listModerationQueue({ status: 'approved', social: 'unposted', notIn: 'immobilier-ndaku' });
  assert.ok(calls.every((call) => !/team_social_posts tsp/.test(call.text)));
});

test('the moderation queue filters on where the team posted, once the table exists', async () => {
  // First query of the table check answers "exists" (cached true afterwards).
  enqueue([{ ok: true }]);
  await getTeamSocialPostsByListing([]);
  reset();
  await listModerationQueue({ status: 'approved', social: 'unposted', notIn: 'immobilier-ndaku' });
  const sql = calls.map((call) => normalizeSql(call.text)).find((text) => text.includes('FROM flagged f') && text.includes('LIMIT'));
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM team_social_posts tsp WHERE tsp\.property_id = p\.id\)/);
  assert.match(sql, /tsp\.target_key = \$\d+/);
  assert.match(sql, /p\.approve_status = 1 AND p\.status = 1/);
});

test('the migration closes the table and matches the key pattern', () => {
  const sql = read('../migrations/20261106_team_social_posts.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS team_social_posts/);
  assert.match(sql, /REVOKE ALL ON team_social_posts FROM anon, authenticated/);
  assert.ok(sql.includes(TARGET_KEY_PATTERN.source));
});

test('the admin wiring: a row button on the live tab, the record action audited, the shared dialog free of admin copy', () => {
  const table = read('app/admin/listings/ModerationTable.js');
  assert.match(table, /<TeamSocialShare\s+variant="icon"/);
  const actions = read('app/admin/listings/shareActions.js');
  assert.match(actions, /action: 'listing\.social_post'/);
  assert.match(actions, /resolveTeamSocialTarget/);
  const dialog = read('components/ListingQuickShare.js');
  assert.ok(!dialog.includes("t('admin."), 'ListingQuickShare also renders for agents; admin copy stays in TeamSocialShare');
});
