import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { FORMATS, FORMAT_KEYS, REPORT_FORMAT, EXPORT_BYTE_BUDGET } from '@/lib/marketing/formats';
import { buildFlyerOps, buildReportOps, baselineOffset, lineBox, wrapText, COLORS } from '@/lib/marketing/layout';
import { buildFlyerPack, optimisableImageSrc, optimisedImageUrl } from '@/lib/marketing/sharePackData';
import {
  buildMandateCaption,
  buildMandateReport,
  reportWindow,
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
  facts: 'Appartement • 24 Novembre, Lingwala',
  rooms: '2 chambres • 2 salles de bain',
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

test('square: the photo band matches the server flyer — 700px cover, 6px white seams', () => {
  const { width, height, ops } = buildFlyerOps(PACK, 'square', env());
  assert.deepEqual([width, height], [1080, 1080]);
  const photos = images(ops).filter((op) => op.key.startsWith('photo:'));
  assert.deepEqual(
    photos.map(({ key, x, y, w, h }) => [key, x, y, w, h]),
    [
      ['photo:0', 0, 0, 700, 640],
      ['photo:1', 706, 0, 374, 317],
      ['photo:2', 706, 323, 374, 317],
    ],
  );
  assert.ok(photos.every((op) => op.fit === 'cover'));
  // The seams are the white ground under the photos, not drawn lines.
  assert.deepEqual(ops[1], { type: 'rect', x: 0, y: 0, w: 1080, h: 640, fill: COLORS.white });
});

test('square: price, facts and rooms sit on the server flyer baselines, on three lines', () => {
  const { ops } = buildFlyerOps(PACK, 'square', env());
  near(textOp(ops, '1 000 $').y, 678 + 72.64, 'price');
  assert.equal(textOp(ops, '1 000 $').size, 80);
  const period = textOp(ops, '/ mois');
  assert.equal(period.x, 48 + measure('1 000 $', { size: 80, weight: 800 }) + 14);
  near(textOp(ops, PACK.facts).y, 808.21, 'facts');
  near(textOp(ops, PACK.rooms).y, 851.8, 'rooms');
});

test('square: roofline mark above the Lukka Place lockup, agent card on the right', () => {
  const { ops } = buildFlyerOps(PACK, 'square', env());
  const mark = images(ops).find((op) => op.key === 'mark');
  assert.equal(mark.x, 83);
  assert.equal(mark.w, 150);
  assert.equal(mark.h, 75);
  near(mark.y, 913.12, 'mark top');
  near(textOp(ops, 'Lukka Place').y, 1033.56, 'lockup baseline');
  assert.ok(textOp(ops, 'lukkaplace.com'));
  assert.ok(ops.some((op) => op.type === 'rect' && op.x === 799 && op.y === 678 && op.w === 176 && op.fill === COLORS.white));
  const initials = textOp(ops, 'MB');
  assert.equal(initials.x, 887);
  near(textOp(ops, 'Makam B').y, 893.2, 'agent name');
  assert.ok(ops.some((op) => op.type === 'icon' && op.name === 'whatsapp'));
  // No watermark on the photo any more.
  assert.ok(!texts(ops).some((op) => op.y < 640 && op.text === 'Lukka Place'));
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

test('a logo replaces the initials; no logo and no name means no brand block at all', () => {
  const withLogo = buildFlyerOps(PACK, 'square', env({ hasLogo: true })).ops;
  assert.ok(images(withLogo).some((op) => op.key === 'logo' && op.fit === 'contain'));
  assert.ok(!textOp(withLogo, 'MB'));

  const bare = { ...PACK, agent: { name: null, initials: null, phone: null, badge: null, logo: null } };
  const ops = buildFlyerOps(bare, 'square', env()).ops;
  assert.ok(!ops.some((op) => op.type === 'rect' && op.w === 176));
  assert.ok(!images(ops).some((op) => op.key === 'logo'));
});

test('fewer photos adapt the grid; none draws the branded panel, never a stand-in photo', () => {
  const two = images(buildFlyerOps(PACK, 'square', env({ photoCount: 2 })).ops).filter((op) => op.key.startsWith('photo:'));
  assert.deepEqual(two.map((op) => [op.x, op.w]), [[0, 537], [543, 537]]);
  const one = images(buildFlyerOps(PACK, 'square', env({ photoCount: 1 })).ops).filter((op) => op.key.startsWith('photo:'));
  assert.deepEqual(one.map((op) => [op.w, op.h]), [[1080, 640]]);
  const none = buildFlyerOps(PACK, 'square', env({ photoCount: 0 })).ops;
  assert.equal(images(none).filter((op) => op.key.startsWith('photo:')).length, 0);
  assert.ok(none.some((op) => op.fill === COLORS.royalDeep));
});

test('every format keeps every operation inside the canvas, even with long text', () => {
  const long = {
    ...PACK,
    facts: 'Maison Type Locataire • Quartier Righini, référence Université de Kinshasa, Lemba',
    rooms: '4 chambres • 3 salles de bain • 450 m² • 12 portes',
    agent: { ...PACK.agent, name: 'Agence Immobilière Les Grands Horizons de Kinshasa', badge: 'Agence partenaire' },
  };
  for (const format of FORMAT_KEYS) {
    for (const photoCount of [0, 1, 2, 3]) {
      const { width, height, ops } = buildFlyerOps(long, format, env({ photoCount, hasLogo: true }));
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

test('the 9:16 keeps the pill and the lockup clear of WhatsApp Status chrome', () => {
  const { ops, height } = buildFlyerOps(PACK, 'story', env());
  const pill = ops.find((op) => op.type === 'rect' && op.fill === COLORS.white && op.radius);
  assert.ok(pill.y >= 150, 'pill below the progress bar and name');
  assert.ok(textOp(ops, 'Lukka Place').y <= height - 150, 'lockup above the reply bar');
  const photos = images(ops).filter((op) => op.key.startsWith('photo:'));
  assert.equal(photos[0].w, 1080);
  assert.equal(photos[1].y - (photos[0].y + photos[0].h), 6, 'same 6px seam');
});

test('the 16:9 puts photos left and the text panel right', () => {
  const { ops } = buildFlyerOps(PACK, 'landscape', env());
  const photos = images(ops).filter((op) => op.key.startsWith('photo:'));
  assert.ok(photos.every((op) => op.x + op.w <= 720));
  assert.ok(textOp(ops, '1 000 $').x >= 720);
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
  assert.ok(pack.photos.every((url) => url.startsWith('/_next/image?url=https%3A%2F%2Fhavyrzfdksabghgbrxfy.supabase.co') && url.endsWith('&w=1080&q=75')));
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

test('the share kit draws in the browser and keeps the server flyer only as a square fallback', () => {
  const kit = readFileSync(path.join(process.cwd(), 'components/AgentListingShareKit.js'), 'utf8');
  assert.match(kit, /renderFlyer\(kit\.pack, format, assets, family\)/);
  assert.match(kit, /const serverFallback = renderFailed && format === 'square' && source\?\.type === 'live'/);
  // A server verdict (not yours / deleted) must never be papered over with a stored copy.
  assert.match(kit, /if \(result && !result\.ok\) \{[\s\S]*?setFailure\('load'\)/);
  const renderer = readFileSync(path.join(process.cwd(), 'components/marketing/CanvasRenderer.js'), 'utf8');
  assert.doesNotMatch(renderer, /from ['"](html2canvas|dom-to-image|html2pdf|jspdf)/);
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
  assert.match(caption, /Ce qu’ils ne comptent pas : les appels et messages envoyés directement à l’agent/);
  assert.match(caption, /https:\/\/lukkaplace\.com\/listings\/305\?utm_source=rapport_proprietaire/);
  // "Clics", never "demandes": a tap is not an enquiry.
  assert.doesNotMatch(caption, /demandes WhatsApp/i);
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
