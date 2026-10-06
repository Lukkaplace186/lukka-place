import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { FORMATS, FORMAT_KEYS, REPORT_FORMAT, EXPORT_BYTE_BUDGET } from '@/lib/marketing/formats';
import { buildFlyerOps, buildReportOps, baselineOffset, displayAmount, lineBox, wrapText, COLORS } from '@/lib/marketing/layout';
import { buildFlyerPack, optimisableImageSrc, optimisedImageUrl } from '@/lib/marketing/sharePackData';
import {
  buildMandateCaption,
  buildMandateReport,
  reportWindow,
  allTimeWindow,
  REPORT_FOOTNOTE,
} from '@/lib/marketing/mandateReportCopy';
import { getMandateCounts, parseEngineTimestamp } from '@/lib/marketing/mandateReport';
import { isStale, packTimestamp, STALE_AFTER_MS } from '@/lib/sharePack';
import { NO_PHOTO_URL } from '@/lib/constants';

/**
 * The share kit's browser-drawn graphics and the landlord report. The layout
 * is data (draw operations), so these assert positions and rules directly —
 * the canvas that paints them is exercised in the browser, not here.
 */

beforeEach(() => reset());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// A deterministic stand-in for canvas measureText: bold is wider.
const measure = (text, { size, weight = 500, letterSpacing = 0 }) =>
  String(text).length * size * (weight >= 700 ? 0.6 : 0.52) + letterSpacing * String(text).length;

const PACK = {
  listingId: 305,
  fetchedAt: '2026-09-16T11:00:00.000Z',
  purposeLabel: 'À LOUER',
  amount: '1 000 $',
  period: '/ mois',
  typeText: 'Appartement',
  place: 'Lingwala',
  facts: 'Appartement • Lingwala',
  rooms: '2 chambres • 2 salles de bain',
  specs: [{ icon: 'bed', text: '2 chambres' }, { icon: 'bath', text: '2 salles de bain' }],
  photoTotal: 10,
  photos: ['a', 'b', 'c'],
  mark: '/brand/icon-dark.png',
  agent: { name: 'Makam B', initials: 'MB', phone: '+44 7932673460', badge: null, logo: null },
};

const env = (overrides = {}) => ({ measure, photoCount: 3, hasLogo: false, hasMark: true, ...overrides });
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.05, `${label}: ${actual} ≠ ${expected}`);
const images = (ops) => ops.filter((op) => op.type === 'image');
const texts = (ops) => ops.filter((op) => op.type === 'text');
const textOp = (ops, text) => texts(ops).find((op) => op.text === text);

test('formats are native sizes, not 2×, and the export budget is 150 KB', () => {
  assert.deepEqual(
    FORMAT_KEYS.map((k) => [FORMATS[k].width, FORMATS[k].height]),
    [[1080, 1080], [1080, 1920], [1200, 675]],
  );
  assert.deepEqual([REPORT_FORMAT.width, REPORT_FORMAT.height], [1080, 1080]);
  assert.equal(EXPORT_BYTE_BUDGET, 150 * 1024);
});

test('text baselines follow the half-leading model with Plus Jakarta Sans metrics', () => {
  near(lineBox(30), 37.8, 'normal line box');
  near(baselineOffset(80, 1), 72.64, 'price baseline in a lineHeight 1 box');
  near(baselineOffset(31, 1.25), 32.0225, 'facts baseline');
});

test('square: rounded photo tiles on the royal ground — 676px cover, 10px gaps, "+N photos" on the last', () => {
  const { width, height, ops } = buildFlyerOps(PACK, 'square', env());
  assert.deepEqual([width, height], [1080, 1080]);
  assert.deepEqual(ops[0], { type: 'rect', x: 0, y: 0, w: 1080, h: 1080, fill: COLORS.royal });
  const photos = images(ops).filter((op) => op.key.startsWith('photo:'));
  assert.deepEqual(
    photos.map(({ key, x, y, w, h }) => [key, x, y, w, h]),
    [
      ['photo:0', 28, 28, 676, 616],
      ['photo:1', 714, 28, 338, 303],
      ['photo:2', 714, 341, 338, 303],
    ],
  );
  assert.ok(photos.every((op) => op.fit === 'cover' && op.radius === 26));
  // The gaps between the photos are white, not the blue ground.
  const backing = ops.findIndex((op) => op.type === 'rect' && op.fill === COLORS.white && op.x === 28 && op.y === 28 && op.w === 1024 && op.h === 616);
  assert.ok(backing > 0 && backing < ops.indexOf(photos[0]), 'white backing under the tiles');
  // PACK.photoTotal 10, three drawn: the veil says how many more there are.
  assert.ok(textOp(ops, '+7'));
  assert.ok(textOp(ops, 'photos'));
  const veil = ops.find((op) => op.type === 'rect' && op.x === 714 && op.y === 341);
  assert.equal(veil.radius, 26);
  // Purpose and type ride on the cover photo.
  assert.equal(textOp(ops, 'À LOUER').color, COLORS.royal);
  assert.ok(textOp(ops, 'Appartement').y < 644);
});

test('no "+N" when every photo is already on the card, or when the pack predates the count', () => {
  for (const pack of [{ ...PACK, photoTotal: 3 }, { ...PACK, photoTotal: undefined }]) {
    assert.ok(!texts(buildFlyerOps(pack, 'square', env()).ops).some((op) => /^\+\d+$/.test(op.text)));
  }
});

test('square: price, pin + place, then the counts as chips with line icons', () => {
  const { ops } = buildFlyerOps(PACK, 'square', env());
  const price = textOp(ops, '1 000 $');
  assert.equal(price.size, 88);
  const period = textOp(ops, '/ mois');
  assert.equal(period.y, price.y, 'period on the price baseline');
  assert.equal(period.x, price.x + measure('1 000 $', { size: 88, weight: 800 }) + 14);
  const place = textOp(ops, 'Lingwala');
  assert.ok(place.y > price.y);
  assert.ok(ops.some((op) => op.type === 'icon' && op.name === 'pin'));
  const icons = ops.filter((op) => op.type === 'icon').map((op) => op.name);
  assert.ok(icons.includes('bed') && icons.includes('bath'));
  const chip = textOp(ops, '2 chambres');
  assert.ok(chip.y > place.y);
  // Everything above the contact bar.
  assert.ok(chip.y < 920);
});

test('the thousands separator is drawn as a plain space — the narrow one vanishes in Plus Jakarta Sans', () => {
  const ops = buildFlyerOps({ ...PACK, amount: '1\u202f300 $' }, 'square', env()).ops;
  assert.ok(textOp(ops, '1 300 $'));
  assert.equal(displayAmount('185\u00a0000 $'), '185 000 $');
});

test('a pack stored before the chips existed still draws its rooms, without icons', () => {
  const { specs, ...old } = PACK;
  assert.ok(specs);
  const ops = buildFlyerOps(old, 'square', env()).ops;
  assert.ok(textOp(ops, '2 chambres'));
  assert.ok(!ops.some((op) => op.type === 'icon' && op.name === 'bed'));
});

test('square: the agent has their own white card on the blue panel, right of the price', () => {
  const { ops } = buildFlyerOps(PACK, 'square', env());
  const card = ops.find((op) => op.type === 'rect' && op.fill === COLORS.white && op.w === 200);
  assert.deepEqual([card.x, card.h, card.radius], [852, 200, 28]);
  assert.ok(card.y >= 644 && card.y + card.h <= 920, 'between the photos and the bar');
  // No logo: the initials, large, in royal blue on the card.
  const initials = textOp(ops, 'MB');
  assert.equal(initials.color, COLORS.royal);
  assert.equal(initials.x, 852 + 100);
  // The price block stays clear of the card.
  const chip = textOp(ops, '2 salles de bain');
  assert.ok(chip.x + measure(chip.text, { size: 24, weight: 700 }) < 852);

  const withLogo = buildFlyerOps(PACK, 'square', env({ hasLogo: true })).ops;
  const logo = images(withLogo).find((op) => op.key === 'logo');
  assert.ok(logo.x > 852 && logo.y > 644 && logo.fit === 'contain');
  assert.equal(images(withLogo).filter((op) => op.key === 'logo').length, 1, 'the logo is drawn once, not again in the bar');
});

test('square: the white contact bar carries the agent name and number on the left and the Lukka Place lockup on the right', () => {
  const { ops } = buildFlyerOps(PACK, 'square', env({ hasMarkLight: true }));
  const bar = ops.find((op) => op.type === 'rect' && op.fill === COLORS.white && op.y === 920);
  assert.deepEqual([bar.x, bar.w, bar.h, bar.radius], [28, 1024, 132, 30]);
  const name = textOp(ops, 'Makam B');
  assert.equal(name.color, COLORS.ink);
  assert.ok(name.x < 80 && name.y > 920, 'name starts the bar, no avatar before it');
  const glyph = ops.find((op) => op.type === 'icon' && op.name === 'whatsapp');
  assert.equal(glyph.color, COLORS.whatsapp);
  const mark = images(ops).find((op) => op.key === 'markLight');
  assert.ok(mark.x > 700, 'lockup on the right');
  assert.equal(textOp(ops, 'Lukka Place').color, COLORS.royal);
  assert.ok(textOp(ops, 'lukkaplace.com'));
  // No Lukka Place text on the photos.
  assert.ok(!texts(ops).some((op) => op.y < 644 && op.text === 'Lukka Place'));
});

test('a pack stored before the colour mark puts the white roofline on a blue tile instead', () => {
  const ops = buildFlyerOps(PACK, 'square', env({ hasMarkLight: false })).ops;
  assert.ok(!images(ops).some((op) => op.key === 'markLight'));
  const mark = images(ops).find((op) => op.key === 'mark');
  assert.ok(ops.some((op) => op.type === 'rect' && op.fill === COLORS.royal && op.x <= mark.x && op.y <= mark.y && op.y > 900));
});

test('lift and legibility: shadows under the white cards, a dark band behind the photo pills', () => {
  const { ops } = buildFlyerOps(PACK, 'square', env());
  // Removed on product direction (2026-10-06): no green accents, no watermark.
  assert.equal(textOp(ops, '/ mois').color, 'rgba(255,255,255,0.75)');
  assert.ok(!images(ops).some((op) => op.alpha));
  assert.ok(!ops.some((op) => op.fill === '#00b050'));
  assert.ok(ops.find((op) => op.type === 'rect' && op.fill === COLORS.white && op.y === 920).shadow, 'bar lifted');
  assert.ok(ops.find((op) => op.type === 'rect' && op.fill === COLORS.white && op.w === 200).shadow, 'logo card lifted');
  const gradient = ops.find((op) => op.gradient);
  assert.ok(ops.indexOf(gradient) < ops.indexOf(textOp(ops, 'À LOUER')));
});

test('the 9:16 has the biggest price', () => {
  assert.equal(textOp(buildFlyerOps(PACK, 'story', env()).ops, '1 000 $').size, 144);
});

test('the gold badge is drawn only when the pack carries one', () => {
  const plain = buildFlyerOps(PACK, 'square', env()).ops;
  assert.ok(!plain.some((op) => op.fill === COLORS.gold));
  assert.ok(!plain.some((op) => op.type === 'icon' && op.name === 'check'));

  for (const format of FORMAT_KEYS) {
    const { ops } = buildFlyerOps({ ...PACK, agent: { ...PACK.agent, badge: 'Agent vérifié' } }, format, env());
    assert.ok(ops.some((op) => op.type === 'rect' && op.fill === COLORS.gold), `${format}: gold pill`);
    assert.equal(textOp(ops, 'Agent vérifié').color, COLORS.ink, `${format}: ink on gold, not white`);
  }
});

test('a logo replaces the initials; no logo and no name means the lockup alone, centred', () => {
  const withLogo = buildFlyerOps(PACK, 'square', env({ hasLogo: true })).ops;
  assert.ok(images(withLogo).some((op) => op.key === 'logo' && op.fit === 'contain'));
  assert.ok(!textOp(withLogo, 'MB'));

  const bare = { ...PACK, agent: { name: null, initials: null, phone: null, badge: null, logo: null } };
  const { ops } = buildFlyerOps(bare, 'square', env({ hasMarkLight: true }));
  assert.ok(!images(ops).some((op) => op.key === 'logo'));
  assert.ok(!ops.some((op) => op.type === 'icon' && op.name === 'whatsapp'));
  const mark = images(ops).find((op) => op.key === 'markLight');
  const name = textOp(ops, 'Lukka Place');
  const url = textOp(ops, 'lukkaplace.com');
  const right = Math.max(name.x + measure('Lukka Place', { size: 26, weight: 800 }), url.x + measure('lukkaplace.com', { size: 20, weight: 600 }));
  near((mark.x + right) / 2, 540, 'lockup centred');
});

test('fewer photos adapt the tiles; none draws the branded tile, never a stand-in photo', () => {
  const two = images(buildFlyerOps(PACK, 'square', env({ photoCount: 2 })).ops).filter((op) => op.key.startsWith('photo:'));
  assert.deepEqual(two.map((op) => [op.x, op.w]), [[28, 507], [545, 507]]);
  const one = images(buildFlyerOps(PACK, 'square', env({ photoCount: 1 })).ops).filter((op) => op.key.startsWith('photo:'));
  assert.deepEqual(one.map((op) => [op.w, op.h]), [[1024, 616]]);
  const none = buildFlyerOps(PACK, 'square', env({ photoCount: 0 })).ops;
  assert.equal(images(none).filter((op) => op.key.startsWith('photo:')).length, 0);
  assert.ok(none.some((op) => op.fill === COLORS.royalDeep));
});

test('every format keeps every operation inside the canvas, even with long text', () => {
  const long = {
    ...PACK,
    typeText: 'Maison Type Locataire',
    place: 'Quartier Righini, référence Université de Kinshasa, Lemba',
    facts: 'Maison Type Locataire • Quartier Righini, référence Université de Kinshasa, Lemba',
    rooms: '4 chambres • 3 salles de bain • 450 m² • 12 portes',
    specs: [
      { icon: 'bed', text: '4 chambres' }, { icon: 'bath', text: '3 salles de bain' },
      { icon: 'area', text: '450 m²' }, { icon: 'door', text: '12 portes' },
    ],
    agent: { ...PACK.agent, name: 'Agence Immobilière Les Grands Horizons de Kinshasa', badge: 'Agence partenaire' },
  };
  for (const format of FORMAT_KEYS) {
    for (const photoCount of [0, 1, 2, 3]) {
      const { width, height, ops } = buildFlyerOps(long, format, env({ photoCount, hasLogo: true, hasMarkLight: photoCount % 2 === 0 }));
      for (const op of ops) {
        const label = `${format}/${photoCount} ${op.type} ${op.text || op.key || op.name || ''}`;
        for (const value of [op.x, op.y, op.w ?? 0, op.h ?? 0]) assert.ok(Number.isFinite(value), label);
        if (op.type === 'text') {
          assert.ok(op.y > 0 && op.y <= height, `${label}: baseline inside`);
          const w = measure(op.text, op);
          const left = op.align === 'center' ? op.x - w / 2 : op.align === 'right' ? op.x - w : op.x;
          assert.ok(left >= -0.5 && left + w <= width + 0.5, `${label}: fits horizontally`);
        } else {
          assert.ok(op.x >= 0 && op.y >= 0 && op.x + (op.w ?? op.size) <= width + 0.5 && op.y + (op.h ?? op.size) <= height + 0.5, `${label}: inside`);
        }
      }
    }
  }
});

test('the 9:16 keeps the pills and the contact bar clear of WhatsApp Status chrome', () => {
  const { ops, height } = buildFlyerOps(PACK, 'story', env());
  const pill = textOp(ops, 'À LOUER');
  assert.ok(pill.y - 30 >= 150, 'pills below the progress bar and name');
  const bar = ops.find((op) => op.type === 'rect' && op.fill === COLORS.white && op.w === 1016);
  assert.ok(bar.y + bar.h <= height - 150, 'contact bar above the reply bar');
  assert.ok(textOp(ops, 'Lukka Place').y <= height - 150);
  const photos = images(ops).filter((op) => op.key.startsWith('photo:'));
  assert.equal(photos[0].w, 1016);
  assert.equal(photos[1].y - (photos[0].y + photos[0].h), 12, '12px gap');
});

test('the 16:9 puts photos left and the text panel right', () => {
  const { ops } = buildFlyerOps(PACK, 'landscape', env());
  const photos = images(ops).filter((op) => op.key.startsWith('photo:'));
  assert.ok(photos.every((op) => op.x + op.w <= 684));
  assert.ok(textOp(ops, '1 000 $').x >= 684);
});

test('wrapText stops at maxLines with an ellipsis and never overflows a line', () => {
  const style = { size: 10, weight: 500 };
  assert.deepEqual(wrapText('un deux trois', 1000, style, 2, measure), ['un deux trois']);
  const lines = wrapText('un deux trois quatre cinq six sept', 80, style, 2, measure);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith('…'));
  assert.ok(lines.every((line) => measure(line, style) <= 80));
  const word = wrapText('Supercalifragilistique', 50, style, 1, measure);
  assert.ok(word[0].endsWith('…') && measure(word[0], style) <= 50);
});

// ---------------------------------------------------------------------------
// Share pack
// ---------------------------------------------------------------------------

const SUPABASE = 'havyrzfdksabghgbrxfy.supabase.co';
const ROW = {
  id: 305, price: 1000, purpose: 'rent', price_period: 'mois', beds: 2, bath: 2, area: null, units_count: null,
  quartier: '24 Novembre', commune: 'Lingwala', status: 1, approve_status: 1, listing_status: null,
  featured_image: `https://${SUPABASE}/storage/v1/object/public/Property_images/properties/305/a.jpg`,
  gallery: [
    NO_PHOTO_URL,
    'https://evil.example.com/b.jpg',
    `https://${SUPABASE}/storage/v1/object/public/Property_images/properties/305/c.jpg`,
  ],
  agent_image: 'https://evil.example.com/logo.png',
};

test('the share pack sends only same-origin optimiser URLs, never a foreign host or the placeholder', () => {
  const pack = buildFlyerPack(ROW, {
    typeText: 'Appartement', brand: { name: 'Makam B', initials: 'MB', phone: null, badge: null },
    supabaseHost: SUPABASE, markPath: '/brand/icon-dark.png', fetchedAt: '2026-09-16T11:00:00.000Z',
  });
  assert.equal(pack.photos.length, 2);
  assert.ok(pack.photos.every((url) => url.startsWith('/_next/image?url=https%3A%2F%2Fhavyrzfdksabghgbrxfy.supabase.co')));
  // The cover at full width, the side tiles at 640 — only what the card draws.
  assert.ok(pack.photos[0].endsWith('&w=1080&q=75'));
  assert.ok(pack.photos[1].endsWith('&w=640&q=75'));
  assert.equal(pack.agent.logo, null, 'a logo on a host the optimiser refuses is dropped');
  assert.equal(pack.facts, 'Appartement • 24 Novembre, Lingwala');
  assert.equal(pack.rooms, '2 chambres • 2 salles de bain');
  assert.equal(pack.purposeLabel, 'À LOUER');
  assert.equal(optimisableImageSrc('http://lukkaplace.com/assets/img/x.jpg'), false, 'https only');
  assert.equal(optimisableImageSrc('//cdn.example.com/x.jpg'), false, 'protocol-relative is foreign');
  assert.equal(optimisedImageUrl('/brand/x.png', 384), '/_next/image?url=%2Fbrand%2Fx.png&w=384&q=75');
});

test('next.config still allows every host and quality the pack relies on', () => {
  const config = readFileSync(path.join(process.cwd(), 'next.config.mjs'), 'utf8');
  assert.match(config, /qualities: \[75\]/);
  assert.match(config, /hostname: 'havyrzfdksabghgbrxfy\.supabase\.co'/);
  assert.match(config, /pathname: '\/storage\/v1\/object\/public\/\*\*'/);
});

test('an offline copy is stamped with the server time and goes stale after 24 h', () => {
  const at = packTimestamp({ pack: { fetchedAt: '2026-09-16T11:00:00.000Z' } });
  assert.equal(at, Date.parse('2026-09-16T11:00:00.000Z'));
  assert.equal(isStale(at, at + STALE_AFTER_MS - 1), false);
  assert.equal(isStale(at, at + STALE_AFTER_MS + 1), true);
  assert.equal(packTimestamp({ pack: {} }), null);
});

test('Documents et rapports: the A4 sheet and the owner report, no poster, no graphic, no caption, no share pack', () => {
  const kit = readFileSync(path.join(process.cwd(), 'components/AgentListingShareKit.js'), 'utf8');
  assert.doesNotMatch(kit, /getSharePackAction|renderFlyer|WatermarkedPhotos|captionFor/);
  assert.doesNotMatch(kit, /\/affiche/);
  assert.match(kit, /\/fiche`/);
  assert.match(kit, /getMandateReportAction\(listingId\)/);
  assert.ok(!existsSync(path.join(process.cwd(), 'app/compte/agent/biens/[id]/visuel/route.js')));
  const renderer = readFileSync(path.join(process.cwd(), 'components/marketing/CanvasRenderer.js'), 'utf8');
  assert.doesNotMatch(renderer, /from ['"](html2canvas|dom-to-image|html2pdf|jspdf)/);
});

test('Partager sur WhatsApp sends the listing card with its caption, the text link one tap away', () => {
  const quick = readFileSync(path.join(process.cwd(), 'components/ListingQuickShare.js'), 'utf8');
  assert.match(quick, /prepareListingCard\(listing\)/);
  assert.match(quick, /const FORMAT = 'square'/);
  const cache = readFileSync(path.join(process.cwd(), 'lib/listingCardCache.js'), 'utf8');
  assert.match(cache, /renderFlyer\(kit\.pack, 'square', decoded, family\)/);
  // Warm-up respects the data plan: never on Data Saver or 2G, capped per page.
  assert.match(cache, /if \(connection\.saveData\) return false;/);
  assert.match(cache, /const WARM_LIMIT = 6;/);
  assert.match(quick, /navigator\.share\(\{ files: \[file\], text: imageCaption \}\)/);
  assert.match(quick, /buildWhatsAppShareLink\(textCaption\)/);
  // Recorded with values listing_shares' CHECKs already allow.
  assert.match(quick, /record\('kit_share', FORMAT\)/);
  assert.match(quick, /record\('menu_whatsapp', 'text'\)/);
  const button = readFileSync(path.join(process.cwd(), 'components/AgentListingWhatsAppButton.js'), 'utf8');
  assert.match(button, /<ListingQuickShare /);
  assert.doesNotMatch(button, /<a\s/);
  const menu = readFileSync(path.join(process.cwd(), 'components/AgentListingActionsMenu.js'), 'utf8');
  // A sibling of the menu, never inside an item that unmounts on close.
  assert.match(menu, /<ListingQuickShare listing=\{listing\} caption=\{caption\} open=\{quickShareOpen\}/);
});

// ---------------------------------------------------------------------------
// Landlord report
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-16T11:42:00Z');

test('the report window is two back-to-back 7-day blocks of whole UTC days, today included', () => {
  const w = reportWindow(NOW);
  assert.equal(w.from.toISOString(), '2026-09-10T00:00:00.000Z');
  assert.equal(w.previousFrom.toISOString(), '2026-09-03T00:00:00.000Z');
  assert.equal(w.end.toISOString(), '2026-09-17T00:00:00.000Z');
});

const COUNTS = {
  current: { views: 42, whatsappClicks: 5, saves: 2, visitRequests: 1 },
  previous: { views: 30, whatsappClicks: 2, saves: 0, visitRequests: 0 },
};
const REPORT_OPTS = { typeText: 'Appartement', brand: { name: 'Makam B', phone: '+44 7932673460' }, window: reportWindow(NOW) };

test('the report caption states what the counts cover and what they do not', () => {
  const report = buildMandateReport(ROW, COUNTS, REPORT_OPTS);
  const caption = buildMandateCaption(ROW, report, COUNTS);
  assert.match(caption, /📊 \*Rapport de diffusion\* — 7 derniers jours · Du 10\/09 au 16\/09\/2026/);
  assert.match(caption, /Vues de l’annonce : \*42\* \(semaine précédente : 30\)/);
  assert.match(caption, /Clics sur WhatsApp : \*5\*/);
  assert.match(caption, /Ce que ces chiffres comptent : .*y compris celles de l’agent/);
  assert.match(caption, /Ce qu’ils ne comptent pas : les appels et messages envoyés à l’agent sans passer par la page/);
  assert.match(caption, /https:\/\/lukkaplace\.com\/listings\/305\?utm_source=rapport_proprietaire/);
  // "Clics", never "demandes": a tap is not an enquiry.
  assert.doesNotMatch(caption, /demandes WhatsApp/i);
});

test('the owner report is all-time: from the day the listing went online, no "previous week"', () => {
  const window = allTimeWindow('2026-09-05T18:49:50.932Z', NOW);
  assert.equal(window.from.toISOString(), '2026-09-05T00:00:00.000Z');
  assert.equal(window.previousFrom.getTime(), window.from.getTime(), 'no comparison block');
  assert.equal(window.end.toISOString(), '2026-09-17T00:00:00.000Z', 'today included');
  const report = buildMandateReport(ROW, COUNTS, { ...REPORT_OPTS, window: allTimeWindow('2026-09-01T10:00:00Z', NOW) });
  assert.match(report.periodText, /^Depuis la mise en ligne · Du 01\/09 au 16\/09\/2026$/);
  assert.ok(report.tiles.every((tile) => tile.note === null));
  const caption = buildMandateCaption(ROW, report, COUNTS);
  assert.doesNotMatch(caption, /semaine précédente/);
  assert.match(caption, /Vues de l’annonce : \*42\*/);
  // No creation date on file: from the start of tracking, never an invented date.
  assert.equal(allTimeWindow(null, NOW).from.toISOString(), '2026-01-01T00:00:00.000Z');
  // The action uses it.
  const actions = readFileSync(path.join(process.cwd(), 'app/compte/agent/shareActions.js'), 'utf8');
  assert.match(actions, /allTimeWindow\(listing\.created_at, new Date\(\)\)/);
});

test('a count the server could not establish is "non disponible", never 0', () => {
  const counts = { current: { ...COUNTS.current, visitRequests: null }, previous: { ...COUNTS.previous, visitRequests: null } };
  const report = buildMandateReport(ROW, counts, REPORT_OPTS);
  const tile = report.tiles.find((t) => t.key === 'visitRequests');
  assert.equal(tile.value, '—');
  assert.match(buildMandateCaption(ROW, report, counts), /Demandes de visite : non disponible pour le moment/);
});

test('a listing off the market reports its status and carries no link', () => {
  const closed = { ...ROW, listing_status: 'closed', status: 0 };
  const report = buildMandateReport(closed, COUNTS, REPORT_OPTS);
  assert.equal(report.statusText, 'Loué');
  assert.equal(report.live, false);
  assert.doesNotMatch(buildMandateCaption(closed, report, COUNTS), /https:\/\//);
});

test('the report card draws four tiles, the footnote, and stays inside the canvas', () => {
  const report = buildMandateReport(ROW, COUNTS, REPORT_OPTS);
  const { width, height, ops } = buildReportOps(report, { measure, hasPhoto: true, hasMark: true });
  assert.equal(ops.filter((op) => op.type === 'rect' && op.fill === COLORS.tile).length, 4);
  assert.ok(textOp(ops, '42') && textOp(ops, '5'));
  assert.ok(textOp(ops, REPORT_FOOTNOTE), 'footnote fits on one line');
  assert.ok(textOp(ops, report.title), 'the title shrinks to fit rather than cutting the commune');
  for (const op of ops) {
    if (op.type !== 'text') continue;
    const w = measure(op.text, op);
    const left = op.align === 'right' ? op.x - w : op.x;
    assert.ok(left >= 0 && left + w <= width + 0.5 && op.y <= height, `report text inside: ${op.text}`);
  }
});

function withEngineEnv() {
  const saved = { base: process.env.ENGINE_API_BASE, secret: process.env.ENGINE_API_SECRET };
  process.env.ENGINE_API_BASE = 'http://engine.test';
  process.env.ENGINE_API_SECRET = 'test-secret';
  return () => {
    for (const [key, value] of [['ENGINE_API_BASE', saved.base], ['ENGINE_API_SECRET', saved.secret]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('report counts read the rollup while fresh, on plain dates', async (t) => {
  t.after(withEngineEnv());
  let asked = null;
  globalThis.fetch = async (url) => (asked = String(url), new Response(JSON.stringify({ data: [
    { created_at: '2026-09-15 10:00:00' },
    { created_at: '2026-09-05 10:00:00' },
    { created_at: '2026-08-01 10:00:00' },
  ] }), { status: 200 }));
  enqueue([{ fresh: true }]);
  enqueue([{ views: 42, prev_views: 30, clicks: 5, prev_clicks: 2, saves: 2, prev_saves: 0 }]);
  const counts = await getMandateCounts(305, reportWindow(NOW));
  const rollup = calls.find((c) => /FROM listing_stats_daily\s+WHERE listing_id/.test(c.sql));
  assert.ok(rollup);
  assert.deepEqual(rollup.values, [305, '2026-09-03', '2026-09-10', '2026-09-17']);
  assert.deepEqual(counts.current, { views: 42, whatsappClicks: 5, saves: 2, visitRequests: 1 });
  assert.deepEqual(counts.previous, { views: 30, whatsappClicks: 2, saves: 0, visitRequests: 1 });
  assert.match(asked, /\/admin\/viewing-requests\?property_ids=305&limit=200$/);
});

test('report counts fall back to raw events, and an unreachable engine gives null visits', async (t) => {
  t.after(withEngineEnv());
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  enqueue([{ fresh: false }]);
  enqueue([{ views: 3, prev_views: 1, clicks: 0, prev_clicks: 0, saves: 0, prev_saves: 0 }]);
  const counts = await getMandateCounts(305, reportWindow(NOW));
  const raw = calls.find((c) => /FROM page_views/.test(c.sql));
  assert.ok(raw);
  assert.equal(raw.values[4], '/listings/305');
  assert.equal(counts.current.visitRequests, null);
  assert.equal(counts.previous.visitRequests, null);
});

test('engine timestamps are read as UTC', () => {
  assert.equal(parseEngineTimestamp('2026-09-15 10:00:00'), Date.parse('2026-09-15T10:00:00Z'));
  assert.equal(parseEngineTimestamp(''), null);
  assert.equal(parseEngineTimestamp('nonsense'), null);
});
