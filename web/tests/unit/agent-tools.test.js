import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CHANNEL_FORMATS, normaliseShareRecord, sheetVariant } from '@/lib/listingShareRules';
import { AGENT_LIVE_LISTINGS_SQL, HELP_TEXT, MES_BIENS_MAX, mesBiensText } from '@/lib/agentCommands';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('"Photos avec mon logo" is gone (2026-10-06): no watermark module, nothing in the pack for it', () => {
  assert.throws(() => read('lib/marketing/watermark.js'));
  assert.throws(() => read('components/marketing/WatermarkedPhotos.js'));
  assert.doesNotMatch(read('lib/marketing/sharePackData.js'), /gallery/);
  assert.match(read('lib/listingFlyer.js'), /agentContactPhone/);
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
