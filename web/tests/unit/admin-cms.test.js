import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AD_FORMATS, adImage, adPlacement, validateAdUrl } from '@/lib/cmsAdRules';
import {
  SEO_DESCRIPTION_MAX,
  SEO_SETTING_KEY,
  SEO_TITLE_MAX,
  seoFromStored,
  seoMetadata,
  validateSeoImageUrl,
  validateSeoInput,
} from '@/lib/siteSettingsRules';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const form = (fields) => ({ get: (name) => fields[name] ?? null });

test('an ad banner is labelled by the format it really stores, never an invented page', () => {
  assert.deepEqual(Object.keys(AD_FORMATS), ['1', '2', '3']);
  assert.deepEqual(adPlacement({ resolution_type: 3 }), { labelKey: 'admin.cms.ads.format.leaderboard', vars: { size: '728 × 90' } });
  assert.deepEqual(adPlacement({ resolution_type: '1' }), { labelKey: 'admin.cms.ads.format.box', vars: { size: '300 × 250' } });
  assert.deepEqual(adPlacement({ resolution_type: 2 }), { labelKey: 'admin.cms.ads.format.sidebar', vars: { size: '300 × 600' } });
  assert.deepEqual(adPlacement({ resolution_type: 9 }), { labelKey: 'admin.cms.ads.format.unknown', vars: { n: 9 } });
  assert.deepEqual(adPlacement({}), { labelKey: 'admin.cms.ads.format.unknown', vars: { n: '—' } });

  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const key of ['box', 'sidebar', 'leaderboard', 'unknown']) assert.ok(dict.admin.cms.ads.format[key], `${lang} ${key}`);
  }
});

test('a banner thumbnail is only an address next/image can load; a bare Laravel file name is named, not drawn', () => {
  assert.deepEqual(adImage('65bf7088a2c9f.png'), { src: null, file: '65bf7088a2c9f.png' });
  assert.deepEqual(adImage(''), { src: null, file: null });
  assert.deepEqual(adImage(null), { src: null, file: null });
  const hosted = 'https://havyrzfdksabghgbrxfy.supabase.co/storage/v1/object/public/listing-images/ad.png';
  assert.deepEqual(adImage(hosted), { src: hosted, file: null });
  assert.deepEqual(adImage('https://example.com/img/ad.png'), { src: null, file: 'ad.png' });
});

test('a banner URL is empty or http(s)', () => {
  assert.deepEqual(validateAdUrl('  '), { ok: true, value: '' });
  assert.deepEqual(validateAdUrl('https://lukkaplace.com/vente'), { ok: true, value: 'https://lukkaplace.com/vente' });
  assert.equal(validateAdUrl('javascript:alert(1)').ok, false);
  assert.equal(validateAdUrl('https://u:p@x.com').ok, false);
  assert.equal(validateAdUrl('not a url').ok, false);
  assert.deepEqual(validateAdUrl(`https://x.com/${'a'.repeat(600)}`), { ok: false, error: 'too_long' });
});

test('the ad table shows a placement, a thumbnail slot, https://… placeholders and Enregistrer', () => {
  const page = read('app/admin/cms/page.js');
  assert.match(page, /adPlacement\(ad\)/);
  assert.match(page, /adImage\(ad\.image\)/);
  assert.equal((page.match(/placeholder="https:\/\/…"/g) || []).length, 1, 'the ad URL input');
  assert.doesNotMatch(page, />\s*OK\s*</, 'no "OK" button left');
  assert.doesNotMatch(page, /ad\.slot \|\| '—'/);
  assert.match(read('app/admin/cms/SeoPanel.js'), /placeholder="https:\/\/…"/);
});

test('the legacy slider taglines are no longer read or edited anywhere in web', () => {
  const page = read('app/admin/cms/page.js');
  const actions = read('app/admin/cms/actions.js');
  const cms = read('lib/cms.js');
  for (const source of [page, actions]) assert.doesNotMatch(source, /getSliders|updateSlider|languageLabel/);
  assert.doesNotMatch(cms, /FROM sliders|UPDATE sliders/);
  for (const lang of ['fr', 'en']) {
    const raw = read(`lib/i18n/${lang}.json`);
    assert.doesNotMatch(raw, /Congo's Largest|Anywhere and Everywhere/);
    assert.equal(JSON.parse(raw).admin.cms.homeBanners, undefined);
  }
});

test('SEO input: per-language title and description, one line, length-capped, image https or a site path', () => {
  const ok = validateSeoInput(form({
    title_fr: '  Lukka Place —\nImmobilier en RDC ',
    title_en: '',
    description_fr: 'Annonces relues.',
    description_en: 'Reviewed listings.',
    og_image_url: 'https://cdn.example.com/card.jpg',
  }));
  assert.deepEqual(ok, {
    ok: true,
    value: {
      title: { fr: 'Lukka Place — Immobilier en RDC', en: '' },
      description: { fr: 'Annonces relues.', en: 'Reviewed listings.' },
      ogImageUrl: 'https://cdn.example.com/card.jpg',
    },
  });
  assert.deepEqual(validateSeoInput(form({ title_en: 'x'.repeat(SEO_TITLE_MAX + 1) })), { ok: false, field: 'title_en', error: 'title_too_long' });
  assert.deepEqual(validateSeoInput(form({ description_fr: 'x'.repeat(SEO_DESCRIPTION_MAX + 1) })), { ok: false, field: 'description_fr', error: 'description_too_long' });
  assert.deepEqual(validateSeoInput(form({ og_image_url: 'http://x.com/a.jpg' })), { ok: false, field: 'og_image_url', error: 'image_https' });

  assert.deepEqual(validateSeoImageUrl('/og-image.png?v=2'), { ok: true, value: '/og-image.png?v=2' });
  assert.equal(validateSeoImageUrl('//evil.com/a.png').ok, false);
  assert.equal(validateSeoImageUrl('https://a b.com').ok, false);
  assert.deepEqual(validateSeoImageUrl(''), { ok: true, value: '' });

  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const code of ['title_too_long', 'description_too_long', 'image_invalid', 'image_https', 'image_too_long']) {
      assert.ok(dict.admin.cms.seo.errors[code], `${lang} ${code}`);
    }
  }
});

test('stored SEO values are re-validated on read, and empty fields fall back to the dictionary', () => {
  assert.equal(SEO_SETTING_KEY, 'site.seo');
  const empty = seoFromStored(null);
  assert.deepEqual(empty, { title: { fr: '', en: '' }, description: { fr: '', en: '' }, ogImageUrl: '' });
  const stored = seoFromStored({ title: { fr: 'Titre', en: 'x'.repeat(200) }, description: { fr: 42 }, ogImageUrl: 'javascript:1' });
  assert.deepEqual(stored, { title: { fr: 'Titre', en: '' }, description: { fr: '', en: '' }, ogImageUrl: '' });

  const defaults = { title: 'Dict title', description: 'Dict description' };
  assert.deepEqual(seoMetadata(null, 'fr', defaults), { title: 'Dict title', description: 'Dict description', image: null });
  const seo = seoFromStored({ title: { fr: 'Titre FR' }, description: { en: 'Desc EN' }, ogImageUrl: 'https://x.com/c.jpg' });
  assert.deepEqual(seoMetadata(seo, 'fr', defaults), { title: 'Titre FR', description: 'Dict description', image: 'https://x.com/c.jpg' });
  assert.deepEqual(seoMetadata(seo, 'en', defaults), { title: 'Dict title', description: 'Desc EN', image: 'https://x.com/c.jpg' });
});

test('the root metadata reads the SEO settings; a page’s own metadata still overrides it', () => {
  const layout = read('app/layout.js');
  assert.match(layout, /getSeoSettings\(\)/);
  assert.match(layout, /seoMetadata\(seo, t\.locale,/);
  assert.match(layout, /images: ogImages/);
  assert.match(layout, /images: \[defaults\.image \|\| OG_IMAGE\]/);
  // Root title is a plain string (no template), so any page title replaces it whole.
  assert.match(layout, /title: SITE_TITLE,/);
  assert.doesNotMatch(layout, /template:/);
  const settings = read('lib/siteSettings.js');
  assert.match(settings, /export async function getSeoSettings[\s\S]*?catch \(err\)[\s\S]*?return null;/, 'never throws into the layout');
  const actions = read('app/admin/cms/actions.js');
  assert.match(actions, /requireAdmin\('cms\.manage'\)[\s\S]*validateSeoInput\(formData\)[\s\S]*saveSeoSettings/);
  assert.match(actions, /revalidatePath\('\/', 'layout'\)/);
});
