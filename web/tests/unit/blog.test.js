import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import {
  articleFromPost,
  mergeArticles,
  parseBody,
  parseCategory,
  postListingsHref,
  postState,
  readingMinutes,
  safeHref,
  slugify,
  validatePostInput,
} from '@/lib/blogRules';
import { PUBLIC_POST_FILTER, listPublicPosts, getPublicPost, listPostsForAdmin } from '@/lib/blog';
import { FEATURE_FLAGS, featuresFromStored } from '@/lib/siteSettingsRules';
import { SECTION_PERMISSIONS, can } from '@/lib/adminRoles';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { GUIDES } from '@/lib/guides';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../..');
const read = (rel) => readFileSync(path.join(web, rel), 'utf8');

beforeEach(() => reset());

const NOW = new Date('2026-10-26T10:00:00Z');
const base = { title_fr: 'Louer à Gombe', summary_fr: 'Résumé', body_fr: 'Texte', category: 'actualite', status: 'draft' };

test('the switch exists, is public and OFF by default', () => {
  const flag = FEATURE_FLAGS.find((f) => f.key === 'publicBlog');
  assert.deepEqual(flag, { key: 'publicBlog', surface: 'public', default: false });
  assert.equal(featuresFromStored(null).publicBlog, false);
  assert.equal(featuresFromStored({ publicBlog: true }).publicBlog, true);
});

test('body format: headings, lists, paragraphs, safe links only', () => {
  const blocks = parseBody([
    'Premier paragraphe',
    'sur deux lignes.',
    '',
    '## Une section',
    '- un',
    '- deux',
    '1. étape',
    '',
    'Voir [Gombe](/location/gombe), [ailleurs](https://example.org) et [piège](javascript:alert(1)).',
  ].join('\n'));
  assert.deepEqual(blocks[0], { p: 'Premier paragraphe sur deux lignes.' });
  assert.deepEqual(blocks[1], { h2: 'Une section' });
  assert.deepEqual(blocks[2], { ul: ['un', 'deux'] });
  assert.deepEqual(blocks[3], { ol: ['étape'] });
  const links = blocks[4].p.filter((s) => s.href);
  assert.deepEqual(links.map((l) => l.href), ['/location/gombe', 'https://example.org/']);
  assert.ok(blocks[4].p.some((s) => !s.href && s.text.includes('javascript:alert(1)')));
  assert.equal(safeHref('//evil.example'), null);
  assert.equal(safeHref('http://plain.example'), null);
});

test('slugs: accents folded, apostrophes dropped', () => {
  assert.equal(slugify('Louer à Gombe : l’essentiel !'), 'louer-a-gombe-lessentiel');
  assert.equal(slugify('  '), '');
});

test('validation: required title, all-or-nothing English, alt with a cover, known commune and type', () => {
  assert.equal(validatePostInput({ ...base, title_fr: '' }).error, 'titleRequired');
  assert.equal(validatePostInput({ ...base, title_en: 'Renting' }).error, 'englishIncomplete');
  assert.equal(validatePostInput({ ...base, cover_url: 'https://x.supabase.co/a.jpg' }).error, 'altRequired');
  assert.equal(validatePostInput({ ...base, commune: 'Atlantis' }).error, 'badCommune');
  assert.equal(validatePostInput({ ...base, property_type: 'chateau' }).error, 'badType');
  assert.equal(validatePostInput({ ...base, slug: 'Pas Bon' }).error, 'badSlug');
  assert.equal(validatePostInput({ ...base, status: 'published', body_fr: '' }).error, 'bodyRequired');

  const ok = validatePostInput({ ...base, commune: 'Gombe', property_type: 'appartement', purpose: 'location' }, { now: NOW });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.slug, 'louer-a-gombe');
  assert.equal(ok.values.published_at, null);
});

test('publishing: no date = now; a datetime-local is Kinshasa time; a future date schedules', () => {
  const now = validatePostInput({ ...base, status: 'published' }, { now: NOW });
  assert.equal(now.values.published_at, NOW.toISOString());
  const local = validatePostInput({ ...base, status: 'published', published_at: '2026-11-01T09:00' }, { now: NOW });
  assert.equal(local.values.published_at, '2026-11-01T08:00:00.000Z');
  assert.equal(postState({ status: 'published', published_at: local.values.published_at }, NOW), 'scheduled');
  assert.equal(postState({ status: 'published', published_at: NOW.toISOString() }, new Date(NOW.getTime() + 1)), 'published');
  assert.equal(postState({ status: 'draft', published_at: NOW.toISOString() }, NOW), 'draft');
});

test('the listings link uses the landing page when one exists', () => {
  assert.equal(postListingsHref({ purpose: 'location', commune: 'Gombe', property_type: 'appartement' }), '/location/appartements/gombe');
  assert.equal(postListingsHref({}), null);
  assert.match(postListingsHref({ purpose: 'vente', commune: 'Kampemba' }), /^\/(vente|listings)/);
});

test('articles: English only when complete, a post replaces the guide with its slug, newest first', () => {
  const row = { id: 1, slug: GUIDES[0].slug, category: 'guide', title_fr: 'FR', body_fr: 'corps', title_en: 'EN', body_en: 'body', published_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z' };
  assert.equal(articleFromPost(row, 'en').lang, 'en');
  assert.equal(articleFromPost({ ...row, body_en: null }, 'en').lang, 'fr');
  const merged = mergeArticles(GUIDES, [row], 'fr');
  assert.equal(merged.length, GUIDES.length);
  assert.equal(merged[0].source, 'post');
  assert.equal(merged.find((a) => a.slug === GUIDES[0].slug).title, 'FR');
  assert.equal(mergeArticles(GUIDES, [], 'fr').every((a) => a.source === 'code'), true);
  assert.equal(parseCategory('actualite'), 'actualite');
  assert.equal(parseCategory('x'), null);
  assert.ok(readingMinutes(merged[1].blocks) >= 1);
});

test('SQL: public reads apply the publication filter; a missing table is no posts', async () => {
  assert.equal(PUBLIC_POST_FILTER, "status = 'published' AND published_at <= NOW() AND deleted_at IS NULL");
  enqueue([]);
  await listPublicPosts();
  enqueue([]);
  await getPublicPost('x');
  for (const call of calls) assert.ok(normalizeSql(call.text).includes(PUBLIC_POST_FILTER));
  await listPostsForAdmin({ q: '50%' });
  const admin = calls[calls.length - 1];
  assert.match(normalizeSql(admin.text), /deleted_at IS NULL/);
  assert.equal(admin.values[0], '%50\\%%');
});

test('console: the section is gated, listed in the sidebar, and writes go through blog.manage', () => {
  assert.equal(SECTION_PERMISSIONS['/admin/blog'], 'blog.manage');
  assert.ok(ADMIN_NAV_HREFS.includes('/admin/blog'));
  assert.equal(can('owner', 'blog.manage'), true);
  assert.equal(can('analyst', 'blog.manage'), false);
  const actions = read('app/admin/blog/actions.js');
  assert.equal((actions.match(/requireAdmin\('blog\.manage'\)/g) || []).length, 3);
  assert.match(actions, /recordAudit/);
});

test('public surfaces: menu link and posts only with the switch; real 404 above the skeleton', () => {
  assert.match(read('app/(site)/layout.js'), /features\.publicBlog \? \[\] : \['\/guides'\]/);
  assert.match(read('app/sitemap.js'), /publicBlog \? listPublicPostSlugs\(\)/);
  assert.match(read('lib/blog.js'), /if \(publicBlog\) \{/);
  assert.ok(existsSync(path.join(web, 'app/(site)/guides/[slug]/layout.js')));
  assert.equal(existsSync(path.join(web, 'app/(site)/guides/loading.js')), false, 'a section skeleton above [slug] makes a soft 404');
  assert.match(read('app/(site)/guides/[slug]/layout.js'), /notFound\(\)/);
});

test('migration: RLS on, anon revoked, slug unique among live posts', () => {
  const sql = read('../migrations/20261026_blog_posts.sql');
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON blog_posts FROM %I/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS blog_posts_slug_live_idx ON blog_posts \(slug\) WHERE deleted_at IS NULL/);
});
