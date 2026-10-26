import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTranslator } from '@/lib/i18n/translate';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import { OG_HEADING_MAX, OG_SIZE, clipHeading, ogCardModel } from '@/lib/listingOgCard';
import { FORMATS } from '@/lib/marketing/formats';
import { COLORS, buildFlyerOps, feedHeading } from '@/lib/marketing/layout';
import { buildFlyerPack } from '@/lib/marketing/sharePackData';
import { LINE_ICONS } from '@/lib/marketing/icons';
import { SHARE_SOURCES, buildListingSocialCopy, socialHashtags } from '@/lib/listingShareCopy';
import { CHANNEL_FORMATS, SHARE_FORMATS, normaliseShareRecord } from '@/lib/listingShareRules';

/**
 * The two-tier sharing strategy (2026-10-26): the listing link preview
 * (og:image, app/(site)/listings/[id]/opengraph-image.js) and the 4:5 feed
 * card in ListingQuickShare. The images themselves are drawn by satori and
 * the canvas; what they SAY and where things go is pure and asserted here.
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const t = createTranslator({ locale: 'fr', messages: fr });

// Listing #387 as the public page reads it.
const LISTING = {
  id: 387,
  title: '3 chambres — Appartement à louer à Ngaliema',
  price: 1800,
  purpose: 'rent',
  price_period: 'mois',
  beds: 3,
  bath: 2,
  area: '0',
  units_count: null,
  quartier: 'GB / Hôtel Diplomate',
  commune: 'Ngaliema',
  category_name: 'Appartement',
  parcelle_subtype: null,
  reference: null,
  verified_at: null,
  deposit_months: 3,
};

// ---------------------------------------------------------------------------
// The link preview card
// ---------------------------------------------------------------------------

test('og card: #387 reads as the canvas does — price, type and two counts, the page heading', () => {
  const model = ogCardModel(LISTING, t);
  assert.deepEqual([OG_SIZE.width, OG_SIZE.height], [1200, 630]);
  assert.equal(model.amount, '1 800 $');
  assert.equal(model.period, '/ mois');
  assert.equal(model.purposeBadge, 'À LOUER');
  assert.equal(model.typeText, 'Appartement');
  assert.deepEqual(model.specs, [{ icon: 'bed', text: '3 ch' }, { icon: 'bath', text: '2 sdb' }]);
  assert.equal(model.heading, 'Appartement à louer — GB / Hôtel Diplomate, Ngaliema');
  assert.equal(model.eyebrow, 'NGALIEMA · KINSHASA');
  assert.equal(model.alt, 'Appartement à louer — GB / Hôtel Diplomate, Ngaliema — 1 800 $ / mois');
  assert.doesNotMatch(model.amount, /[  ]/, 'plain spaces: the narrow ones draw as nothing');
});

test('og card: the badge needs verified_at; a sale has no period; no price is "Prix sur demande"', () => {
  assert.equal(ogCardModel(LISTING, t).verified, false);
  assert.equal(ogCardModel({ ...LISTING, verified_at: '2026-10-20T10:00:00Z' }, t).verified, true);

  const sale = ogCardModel({ ...LISTING, purpose: 'sale', price: 250000 }, t);
  assert.equal(sale.amount, '250 000 $');
  assert.equal(sale.period, null);
  assert.equal(sale.purposeBadge, 'À VENDRE');
  assert.match(sale.heading, /^Appartement à vendre — /);

  const noPrice = ogCardModel({ ...LISTING, price: 0 }, t);
  assert.equal(noPrice.amount, 'Prix sur demande');
  assert.equal(noPrice.period, null);
});

test('og card: only stated counts, two at most; no commune means no commune in the eyebrow', () => {
  const bare = ogCardModel({ ...LISTING, beds: 0, bath: '', area: '450', units_count: 6 }, t);
  assert.deepEqual(bare.specs, [{ icon: 'area', text: '450 m²' }, { icon: 'door', text: '6 portes' }]);
  assert.deepEqual(ogCardModel({ ...LISTING, beds: null, bath: null }, t).specs, []);
  assert.equal(ogCardModel({ ...LISTING, commune: null }, t).eyebrow, 'KINSHASA');
});

test('og card: a long heading is cut at a word with "…", within two lines', () => {
  const long = 'Appartement à louer — Quartier Righini, référence Université de Kinshasa, près du rond-point, Lemba';
  const cut = clipHeading(long);
  assert.ok(cut.length <= OG_HEADING_MAX, cut);
  assert.ok(cut.endsWith('…'));
  assert.ok(long.startsWith(cut.slice(0, -1)));
  assert.equal(clipHeading('Court'), 'Court');
});

test('og route: JPEG, behind the public gate, and the page no longer sets the raw photo', () => {
  const route = read('app/(site)/listings/[id]/opengraph-image.js');
  assert.match(route, /export const contentType = 'image\/jpeg'/);
  assert.match(route, /export const size = \{ width: 1200, height: 630 \}/);
  assert.match(route, /getListingById\(id\)/, 'the same status = 1 AND approve_status = 1 read as the page');
  assert.match(route, /status: 404/);
  assert.match(route, /pngToJpeg/);
  assert.match(read('app/(site)/listings/[id]/twitter-image.js'), /import Image from '\.\/opengraph-image'/);

  const page = read('app/(site)/listings/[id]/page.js');
  const meta = page.slice(page.indexOf('export async function generateMetadata'), page.indexOf('async function AgentProfileLink'));
  assert.doesNotMatch(meta, /images:/, 'file-based og:image is the one source');
  assert.match(meta, /card: 'summary_large_image'/);
});

// ---------------------------------------------------------------------------
// The 4:5 feed card
// ---------------------------------------------------------------------------

const measure = (text, { size, weight = 500, letterSpacing = 0 }) =>
  String(text).length * size * (weight >= 700 ? 0.6 : 0.52) + letterSpacing * String(text).length;

const PACK = {
  listingId: 387,
  purposeLabel: 'À LOUER',
  amount: '1 800 $',
  period: '/ mois',
  typeText: 'Appartement',
  place: 'GB / Hôtel Diplomate, Ngaliema',
  refLabel: 'Annonce n° 387',
  specs: [{ icon: 'bed', text: '3 chambres' }, { icon: 'bath', text: '2 salles de bain' }],
  photoTotal: 5,
  photos: ['a'],
  verified: false,
  agent: { name: 'Agence Test', initials: 'AT', phone: null, badge: null, logo: null },
};
const env = (over = {}) => ({ measure, photoCount: 1, hasWordmark: true, ...over });
const texts = (ops) => ops.filter((op) => op.type === 'text');
const textOp = (ops, text) => texts(ops).find((op) => op.text === text);

test('feed: 1080 × 1350, the cover full width over the top 900px, the wordmark top-right', () => {
  assert.deepEqual([FORMATS.feed.width, FORMATS.feed.height], [1080, 1350]);
  const { width, height, ops } = buildFlyerOps(PACK, 'feed', env());
  assert.deepEqual([width, height], [1080, 1350]);
  const cover = ops.find((op) => op.type === 'image' && op.key === 'photo:0');
  assert.deepEqual([cover.x, cover.y, cover.w, cover.h, cover.fit], [0, 0, 1080, 900, 'cover']);
  const mark = ops.find((op) => op.type === 'image' && op.key === 'wordmark');
  assert.deepEqual([mark.x + mark.w, mark.y], [1024, 66]);
  assert.ok(!textOp(ops, 'Lukka Place'), 'no typed name when the logo drew');
  assert.ok(textOp(buildFlyerOps(PACK, 'feed', env({ hasWordmark: false })).ops, 'Lukka Place'), 'typed name without it');
  assert.ok(!buildFlyerOps(PACK, 'feed', env({ photoCount: 0 })).ops.some((op) => op.type === 'image' && op.key.startsWith('photo:')));
});

test('feed: price on the royal badge, heading and light chips in the panel', () => {
  const { ops } = buildFlyerOps(PACK, 'feed', env());
  const price = textOp(ops, '1 800 $');
  assert.equal(price.size, 104);
  assert.equal(textOp(ops, '/ mois').y, price.y, 'period on the price baseline');
  assert.ok(ops.some((op) => op.type === 'rect' && op.fill === COLORS.royal && op.x === 56 && op.y === 56));
  assert.equal(textOp(ops, 'À LOUER · APPARTEMENT').letterSpacing, 3);
  assert.equal(feedHeading(PACK), 'Appartement à louer');
  assert.ok(textOp(ops, 'Appartement à louer').y > 900);
  for (const chip of ['3 chambres', '2 salles de bain', 'Annonce n° 387']) {
    assert.equal(textOp(ops, chip).color, COLORS.inkDeep, chip);
  }
  assert.ok(ops.some((op) => op.type === 'rect' && op.fill === COLORS.porcelain));
  // A long amount shrinks the price rather than running into the wordmark.
  const big = buildFlyerOps({ ...PACK, purposeLabel: 'À VENDRE', amount: '12 500 000 $', period: null }, 'feed', env()).ops;
  const bigPrice = textOp(big, '12 500 000 $');
  assert.ok(bigPrice.size < 104);
  assert.ok(bigPrice.x + measure(bigPrice.text, bigPrice) <= 1080 - 56 - 240 - 32);
});

test('feed: "Vérifié par Lukka Place" only for a verified property; "N photos" only with more than one', () => {
  const plain = buildFlyerOps(PACK, 'feed', env()).ops;
  assert.ok(!textOp(plain, 'Vérifié par Lukka Place'));
  assert.ok(textOp(plain, '5 photos'));
  const verified = buildFlyerOps({ ...PACK, verified: true }, 'feed', env()).ops;
  assert.ok(textOp(verified, 'Vérifié par Lukka Place'));
  assert.ok(verified.some((op) => op.type === 'icon' && op.name === 'badgeCheck'));
  // The agent's tier is not the property's verification.
  assert.ok(!textOp(buildFlyerOps({ ...PACK, agent: { ...PACK.agent, badge: 'Agent vérifié' } }, 'feed', env()).ops, 'Vérifié par Lukka Place'));
  assert.ok(!textOp(buildFlyerOps({ ...PACK, photoTotal: 1 }, 'feed', env()).ops, '1 photos'));
  assert.ok(LINE_ICONS.badgeCheck && LINE_ICONS.image);
});

test('feed: the band names the agent only with a number the page would publish', () => {
  const none = buildFlyerOps(PACK, 'feed', env()).ops;
  assert.ok(textOp(none, 'Retrouvez ce bien sur Lukka Place'));
  assert.ok(!none.some((op) => op.type === 'icon' && op.name === 'whatsapp'));
  const reachable = buildFlyerOps({ ...PACK, agent: { ...PACK.agent, phone: '+243 812 345 678' } }, 'feed', env()).ops;
  assert.ok(textOp(reachable, 'Contactez l’agent sur WhatsApp'));
  assert.ok(textOp(reachable, '+243 812 345 678 · lukkaplace.com'));
  assert.ok(reachable.some((op) => op.type === 'icon' && op.name === 'whatsapp'));
});

test('the share pack carries the wordmark and the property verification', () => {
  const pack = buildFlyerPack(
    { ...LISTING, featured_image: null, gallery: [], verified_at: '2026-10-20T10:00:00Z' },
    { typeText: 'Appartement', brand: {}, markPath: '/brand/icon-dark.png', wordmarkPath: '/brand/logo-dark.png?v=2', fetchedAt: 'x' },
  );
  assert.equal(pack.wordmark, '/brand/logo-dark.png?v=2');
  assert.equal(pack.verified, true);
  assert.equal(buildFlyerPack({ ...LISTING, gallery: [] }, { typeText: null, brand: {}, markPath: 'm', fetchedAt: 'x' }).verified, false);
  assert.match(read('lib/listingFlyer.js'), /p\.verified_at,/);
});

// ---------------------------------------------------------------------------
// The feed caption
// ---------------------------------------------------------------------------

test('social caption: no WhatsApp *bold*, the same facts, hashtags from real fields only', () => {
  const url = 'https://lukkaplace.com/listings/387?utm_source=reseaux_sociaux';
  const social = buildListingSocialCopy(LISTING, { typeText: 'Appartement', url, style: 'social' });
  assert.doesNotMatch(social, /\*/);
  assert.match(social, /^À LOUER · Appartement\n1\s800 \$ \/ mois\n📍 GB \/ Hôtel Diplomate, Ngaliema/);
  assert.match(social, /▸ Garantie 3 mois/);
  assert.ok(social.endsWith('#Kinshasa #Ngaliema #AppartementÀLouer #LukkaPlace'), social);
  assert.ok(social.includes(url));

  const whatsapp = buildListingSocialCopy(LISTING, { typeText: 'Appartement', url });
  assert.match(whatsapp, /^\*À LOUER\* · Appartement/, 'the WhatsApp caption is unchanged');
  assert.doesNotMatch(whatsapp, /#/);

  assert.deepEqual(socialHashtags({ ...LISTING, commune: 'Mont-Ngafula', purpose: 'sale' }, { typeText: 'Terrain' }),
    ['#Kinshasa', '#MontNgafula', '#TerrainÀVendre', '#LukkaPlace']);
  assert.deepEqual(socialHashtags({ purpose: null, commune: null }), ['#Kinshasa', '#LukkaPlace']);
  assert.equal(SHARE_SOURCES.social, 'reseaux_sociaux');
  assert.match(read('app/compte/agent/shareActions.js'), /style: channel === 'social' \? 'social' : 'whatsapp'/);
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

test('a feed share or download is recorded as `feed`, and the migration allows it', () => {
  assert.ok(CHANNEL_FORMATS.kit_share.includes('feed'));
  assert.ok(CHANNEL_FORMATS.kit_download.includes('feed'));
  assert.deepEqual(normaliseShareRecord({ listingIds: [387], channel: 'kit_share', format: 'feed' }), { ids: [387], channel: 'kit_share', format: 'feed' });
  assert.equal(normaliseShareRecord({ listingIds: [387], channel: 'status_share', format: 'feed' }), null);
  const sql = read('../migrations/20261026_listing_share_feed_format.sql');
  const formats = sql.match(/format IN \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(formats, [...SHARE_FORMATS].sort());
});

test('the quick-share dialog offers the square and the 4:5, with every label in both dictionaries', () => {
  const component = read('components/ListingQuickShare.js');
  assert.match(component, /const FORMATS = \['square', 'feed'\]/);
  assert.match(component, /prepareListingCard\(listing, format\)/);
  assert.match(component, /kit\?\.copies\?\.social/);
  const en = JSON.parse(read('lib/i18n/en.json'));
  for (const messages of [fr, en]) {
    const q = messages.agent.quickShare;
    for (const key of ['formatLabel', 'titleFeed', 'descriptionFeed', 'shareFeed', 'downloadShort', 'copyCaption', 'captionCopiedShort', 'hintFeed']) {
      assert.ok(typeof q[key] === 'string' && q[key], key);
    }
    assert.ok(q.formats.square && q.formats.feed);
  }
});
