import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  WATERMARK_BAND_MAX, WATERMARK_BAND_MIN, WATERMARK_MAX_EDGE, buildWatermarkOps, watermarkFileName, watermarkSize,
} from '@/lib/marketing/watermark';
import { CHANNEL_FORMATS, normaliseShareRecord, sheetVariant } from '@/lib/listingShareRules';
import { AGENT_LIVE_LISTINGS_SQL, HELP_TEXT, MES_BIENS_MAX, mesBiensText } from '@/lib/agentCommands';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const measure = (text, { size }) => String(text).length * size * 0.55;
const texts = (ops) => ops.filter((op) => op.type === 'text').map((op) => op.text);

// --- watermarked photos -------------------------------------------------------------

test('a photo keeps its own aspect, longest edge at most 1080, never upscaled', () => {
  assert.deepEqual(watermarkSize(4000, 3000), { width: WATERMARK_MAX_EDGE, height: 810 });
  assert.deepEqual(watermarkSize(900, 1600), { width: 608, height: WATERMARK_MAX_EDGE });
  assert.deepEqual(watermarkSize(800, 600), { width: 800, height: 600 });
  assert.equal(watermarkSize(0, 600), null);
});

test('the band covers the bottom edge, sized from the shorter side within its bounds', () => {
  const { ops } = buildWatermarkOps({ width: 1080, height: 810, agent: { name: 'Makam Immo', phone: '+243 81 234 5678' }, hasLogo: true, measure });
  assert.deepEqual(ops[0], { type: 'image', key: 'photo:0', x: 0, y: 0, w: 1080, h: 810, fit: 'cover' });
  const band = ops[1];
  assert.equal(band.type, 'rect');
  assert.equal(band.y + band.h, 810);
  assert.ok(band.h >= WATERMARK_BAND_MIN && band.h <= WATERMARK_BAND_MAX);
  assert.deepEqual(texts(ops), ['lukkaplace.com', 'Makam Immo', '+243 81 234 5678']);
  assert.ok(ops.some((op) => op.type === 'image' && op.key === 'logo'));
});

test('no phone passed, no phone drawn; initials stand in for a missing logo', () => {
  const { ops } = buildWatermarkOps({ width: 1080, height: 1080, agent: { name: 'Makam Immo', initials: 'MI' }, hasLogo: false, measure });
  assert.deepEqual(texts(ops), ['lukkaplace.com', 'MI', 'Makam Immo']);
  assert.ok(!ops.some((op) => op.key === 'logo'));
});

test('no brand at all: only "lukkaplace.com" — never a Lukka Place mark passed off as the agent', () => {
  const { ops } = buildWatermarkOps({ width: 1080, height: 720, agent: {}, hasLogo: false, measure });
  assert.deepEqual(texts(ops), ['lukkaplace.com']);
  assert.equal(watermarkFileName(310, 1), 'lukka-310-photo-2-logo.jpg');
});

test('the phone on the pack is the verified-number rule (agentContactPhone), not the raw number', () => {
  const flyer = read('lib/listingFlyer.js');
  assert.match(flyer, /agentContactPhone/);
  assert.match(read('lib/marketing/sharePackData.js'), /gallery,/);
});

test('share records accept watermarked photos, the neutral sheet and "!share", nothing else new', () => {
  assert.deepEqual(normaliseShareRecord({ listingId: 3, channel: 'kit_download', format: 'watermarked_photo' }), { ids: [3], channel: 'kit_download', format: 'watermarked_photo' });
  assert.ok(normaliseShareRecord({ listingId: 3, channel: 'print', format: 'fiche_neutre' }));
  assert.ok(normaliseShareRecord({ listingId: 3, channel: 'wa_command', format: 'text' }));
  assert.equal(normaliseShareRecord({ listingId: 3, channel: 'wa_command', format: 'square' }), null);
  assert.deepEqual(CHANNEL_FORMATS.print, ['poster', 'fiche', 'fiche_neutre']);
});

// --- the neutral sheet ----------------------------------------------------------------

test('the sheet variant is "neutre" only when asked for exactly', () => {
  assert.equal(sheetVariant({ variant: 'neutre' }), 'neutre');
  assert.equal(sheetVariant({ variant: ['neutre'] }), 'neutre');
  assert.equal(sheetVariant({ variant: 'NEUTRE' }), 'complete');
  assert.equal(sheetVariant({}), 'complete');
});

test('the neutral sheet prints no logo, reference, agent, QR, link or map pin', () => {
  const sheet = read('components/print/ListingTechSheet.js');
  assert.match(sheet, /\{neutral \? <span className="lp-fiche-ref">Fiche descriptive<\/span> : <img className="lp-logo"/);
  assert.match(sheet, /sheet\.reference && !neutral/);
  assert.match(sheet, /sheet\.mapUrl && !neutral/);
  assert.match(sheet, /Nom : _+/);
  // The QR and the agent's contact live only in the non-neutral branch.
  const neutralBranch = sheet.slice(sheet.indexOf('{neutral ? ('), sheet.indexOf(') : (', sheet.indexOf('{neutral ? (')));
  assert.ok(!/lp-qr|agentName|agentPhone|displayUrl/.test(neutralBranch));
  assert.match(read('components/print/PrintToolbar.js'), /variant === 'neutre' \? 'fiche_neutre' : medium/);
});

// --- WhatsApp commands ------------------------------------------------------------------

test("!mesbiens lists the agent's own public listings only, newest first", () => {
  const sql = AGENT_LIVE_LISTINGS_SQL.replace(/\s+/g, ' ');
  assert.match(sql, /p\.agent_id = \$1 AND p\.status = 1 AND p\.approve_status = 1/);
  assert.match(sql, /ORDER BY p\.created_at DESC LIMIT \$2/);
  assert.equal(MES_BIENS_MAX, 10);
});

test('the !mesbiens reply names each listing by number with a tagged link, and says when there are more', () => {
  const text = mesBiensText([{ id: 310, title: 'Appartement Kintambo', price: 1300, purpose: 'rent', price_period: 'mois' }], 11);
  assert.match(text, /n° 310 — Appartement Kintambo — 1\s300 \$ \/ mois/);
  assert.match(text, /listings\/310\?utm_source=wa_command/);
  assert.match(text, /…et d’autres dans Mes biens/);
  assert.match(text, /!share 310/);
  assert.match(mesBiensText([]), /aucune annonce en ligne/);
  assert.match(HELP_TEXT, /!mesbiens/);
});

test('the internal route is Bearer CRON_SECRET, timing-safe, and !share checks ownership in SQL', () => {
  const route = read('app/api/internal/agent-command/route.js');
  assert.match(route, /crypto\.timingSafeEqual/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  const lib = read('lib/agentCommands.js');
  assert.match(lib, /getFlyerListing\(agentId, id\)/);
  assert.match(lib, /shareBlocker\(listing\)/);
  assert.match(lib, /channel: 'wa_command', format: 'text'/);
});
