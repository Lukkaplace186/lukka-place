import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import { formatPrice } from '@/lib/format';
import {
  agentContactPhone,
  buildListingSocialCopy,
  roomSpecs,
  shareBlocker,
  listingPublicUrl,
  SHARE_SOURCES,
} from '@/lib/listingShareCopy';
import {
  isVerifiedLevel,
  levelRequirementMissing,
  sniffDocumentType,
} from '@/lib/verificationLevels';
import { highestSupportedLevel } from '@/lib/agentVerification';
import { isEmptyDraft, looksOffline } from '@/lib/offlineDrafts';
import { getPerListingStats } from '@/lib/analytics';
import { findRecentOwnDuplicate } from '@/lib/agentListings';

/**
 * The agent growth toolkit: social copy + flyer, verification tiers, offline
 * drafts, and the analytics rollup read path. Most of it is pure rules whose
 * whole point is refusing to state something the data does not support — so
 * that is what these assert.
 */

beforeEach(() => reset());

const LISTING = {
  id: 286,
  purpose: 'rent',
  price: 700,
  price_period: 'mois',
  beds: 2,
  bath: 1,
  area: '120',
  units_count: null,
  quartier: 'Righini',
  commune: 'Lemba',
  reference: 'Demiap',
  deposit_months: 3,
  advance_months: 1,
  commission_months: 1,
  approve_status: 1,
  status: 1,
  listing_status: 'active',
};

// ---------------------------------------------------------------------------
// Social copy
// ---------------------------------------------------------------------------

test('social copy states purpose, place, price, rooms, itemised terms, reference and the link last', () => {
  const copy = buildListingSocialCopy(LISTING, { typeText: 'Appartement', url: listingPublicUrl(286) });
  const lines = copy.split('\n');
  // *…* is WhatsApp's own bold, where this text is posted.
  assert.equal(lines[0], '🏠 *À LOUER* · Appartement');
  assert.equal(lines[1], '📍 *Righini, Lemba*');
  assert.match(lines[2], /^💰 \*700 \$ \/ mois\*$/);
  assert.equal(lines[3], '🛏️ 2 chambres · 1 salle de bain · 120 m²');
  assert.equal(lines[4], '🔑 Garantie : 3 + 1 + 1 mois');
  assert.equal(lines[5], 'Réf. Demiap');
  assert.match(lines[lines.length - 1], /https:\/\/[^ ]+\/listings\/286$/);
});

test('the caption carries the agent contact only when the listing page would publish that number', () => {
  const verified = { ...LISTING, agent_phone_raw: '243990000000', agent_phone_verified_at: '2026-09-01', agent_direct_routing_enabled: true };
  assert.match(buildListingSocialCopy(verified, { contactPhone: agentContactPhone(verified) }), /📞 \*Contact agent\* : \+243/);

  for (const blocked of [
    { ...verified, agent_phone_verified_at: null },
    { ...verified, agent_direct_routing_enabled: false },
  ]) {
    assert.equal(agentContactPhone(blocked), null);
    assert.doesNotMatch(buildListingSocialCopy(blocked, { contactPhone: agentContactPhone(blocked) }), /Contact agent/);
  }
});

test('social copy never sums the entry costs into one "Garantie" figure', () => {
  const copy = buildListingSocialCopy(LISTING, { typeText: 'Appartement' });
  assert.doesNotMatch(copy, /Garantie : 5 mois/);
});

test('social copy leaves out every line it has no data for — no filler', () => {
  const copy = buildListingSocialCopy(
    { purpose: 'sale', price: 85000, beds: 0, bath: '', area: '0', deposit_months: null },
    {},
  );
  // formatPrice's own thousands separator (fr-FR's narrow no-break space).
  assert.equal(copy, `🏠 *À VENDRE*\n💰 *${formatPrice(85000, 'sale', null)}*`);
});

test('a price of zero is "Prix sur demande", never "0 $"', () => {
  assert.match(buildListingSocialCopy({ purpose: 'rent', price: 0 }), /Prix sur demande/);
});

test('room specs pluralise and skip unknown counts', () => {
  assert.deepEqual(roomSpecs({ beds: 1, bath: 2, area: '0', units_count: 6 }), ['1 chambre', '2 salles de bain', '6 portes']);
  assert.deepEqual(roomSpecs({ beds: null, bath: null, area: null, units_count: null }), []);
});

test('only a public, on-market listing can be shared — anything else would share a dead or misleading link', () => {
  assert.equal(shareBlocker(LISTING), null);
  assert.equal(shareBlocker({ ...LISTING, approve_status: 0 }), 'pending');
  assert.equal(shareBlocker({ ...LISTING, approve_status: '2' }), 'rejected');
  assert.equal(shareBlocker({ ...LISTING, status: 0 }), 'archived');
  assert.equal(shareBlocker({ ...LISTING, listing_status: 'under_offer' }), 'under_offer');
  assert.equal(shareBlocker({ ...LISTING, listing_status: 'closed', status: 0 }), 'closed');
});

// lib/listingFlyer.js imports the French dictionary as JSON, which this plain
// Node test tier cannot load without an import attribute; its rules are
// asserted through the pure sniffer it uses and on its source text instead.
test('flyer photos are accepted by magic bytes, not by extension — and an HTML error page is not a photo', () => {
  const pad = (bytes) => Buffer.from([...bytes, ...new Array(16).fill(0)]);
  assert.equal(sniffDocumentType(pad([0xff, 0xd8, 0xff, 0xe0]))?.mime, 'image/jpeg');
  assert.equal(sniffDocumentType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime, 'image/png');
  assert.equal(sniffDocumentType(Buffer.from('<html><body>404 Not Found</body></html>')), null);
  const src = readFileSync(path.join(process.cwd(), 'lib/listingFlyer.js'), 'utf8');
  assert.match(src, /FLYER_IMAGE_TYPES = \['image\/jpeg', 'image\/png'\]/);
});

test('the flyer refuses anything not owned by the session agent (ownership in SQL) and fetches only our hosts', () => {
  const src = readFileSync(path.join(process.cwd(), 'lib/listingFlyer.js'), 'utf8');
  assert.match(src, /WHERE p\.id = \$2 AND p\.agent_id = \$3/);
  assert.match(src, /url\.protocol !== 'https:' \|\| !hosts\.has\(url\.host\)/);
});

test('the flyer carries the agent brand on royal blue, and no QR code anywhere', () => {
  const lib = readFileSync(path.join(process.cwd(), 'lib/listingFlyer.js'), 'utf8');
  const route = readFileSync(path.join(process.cwd(), 'app/compte/agent/biens/[id]/visuel/route.js'), 'utf8');
  for (const [name, src] of [['lib', lib], ['route', route]]) {
    assert.doesNotMatch(src, /qrcode|QRCode|qrDataUri/, `${name} must not reference the removed QR code`);
  }
  // The brand colour is the palette's own --blue, not a near-miss navy.
  assert.match(route, /const ROYAL = '#1e3aa8'/);
  assert.match(route, /background: ROYAL/);
  assert.match(lib, /export async function loadAgentBrand/);
});

test('the gold badge is only ever drawn for a reviewed agent, never as decoration', () => {
  const lib = readFileSync(path.join(process.cwd(), 'lib/listingFlyer.js'), 'utf8');
  const route = readFileSync(path.join(process.cwd(), 'app/compte/agent/biens/[id]/visuel/route.js'), 'utf8');
  // The badge label comes from the reviewed tier, and nothing else can set it.
  assert.match(lib, /const badge = isVerifiedLevel\(level\) \? BADGE_LABELS\[level\] : null/);
  assert.match(route, /\{brand\.badge \? \(/);
  assert.match(route, /const GOLD = '#f59e0b'/);
});

test('the flyer seams are 6px of white, the Lukka Place mark sits in the footer, not on the photo', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/compte/agent/biens/[id]/visuel/route.js'), 'utf8');
  assert.match(route, /const GAP = 6;/);
  // White behind the photo band is what the gaps actually show.
  assert.match(route, /height: PHOTO_HEIGHT, background: '#ffffff'/);
  assert.doesNotMatch(route, /rgba\(255,255,255,0\.6\)/, 'the photo watermark was removed');
  assert.match(route, /loadPlatformMark\(\)/);
  // Rooms get their own line in full words.
  assert.match(route, /const rooms = roomSpecs\(listing\)/);
  const lib = readFileSync(path.join(process.cwd(), 'lib/listingFlyer.js'), 'utf8');
  assert.match(lib, /PLATFORM_MARK_PATH = '\/brand\/icon-dark\.png'/);
});

test('the flyer prints an agent phone only under the public listing rule, and never invents a logo', () => {
  const src = readFileSync(path.join(process.cwd(), 'lib/listingFlyer.js'), 'utf8');
  assert.match(src, /const phone = agentContactPhone\(listing\)/);
  // No logo and no name means no brand block — never a Lukka Place mark
  // standing in for the agent's own.
  const route = readFileSync(path.join(process.cwd(), 'app/compte/agent/biens/[id]/visuel/route.js'), 'utf8');
  assert.match(route, /const hasBrand = Boolean\(brand\.logo \|\| brand\.initials\)/);
  assert.match(route, /\{hasBrand \? \(/);
});

// ---------------------------------------------------------------------------
// Verification tiers
// ---------------------------------------------------------------------------

test('is_verified is derived from the level, and "standard" is not verified', () => {
  assert.equal(isVerifiedLevel('verified'), true);
  assert.equal(isVerifiedLevel('agency_partner'), true);
  assert.equal(isVerifiedLevel('standard'), false);
  assert.equal(isVerifiedLevel(null), false);
});

test('a level cannot be granted without the approved documents it stands for', () => {
  const pendingId = [{ doc_type: 'id_card', status: 'pending' }];
  const approvedId = [{ doc_type: 'passport', status: 'approved' }];
  assert.equal(levelRequirementMissing('verified', []), 'identity_required');
  assert.equal(levelRequirementMissing('verified', pendingId), 'identity_required');
  assert.equal(levelRequirementMissing('verified', approvedId), null);
  assert.equal(levelRequirementMissing('agency_partner', approvedId), 'rccm_required');
  assert.equal(
    levelRequirementMissing('agency_partner', [...approvedId, { doc_type: 'rccm', status: 'approved' }]),
    null,
  );
  assert.equal(levelRequirementMissing('standard', []), null);
  assert.equal(levelRequirementMissing('gold', []), 'unknown_level');
});

test('rejecting the evidence lowers a level to what the remaining documents support', () => {
  const idOnly = [{ doc_type: 'id_card', status: 'approved' }, { doc_type: 'rccm', status: 'rejected' }];
  assert.equal(highestSupportedLevel('agency_partner', idOnly), 'verified');
  assert.equal(highestSupportedLevel('verified', [{ doc_type: 'id_card', status: 'rejected' }]), 'standard');
  // Never RAISES: a standard agent with approved documents stays standard until a human sets it.
  assert.equal(highestSupportedLevel('standard', idOnly), 'standard');
});

test('verification uploads are identified by content: images and PDF only', () => {
  const pad = (bytes) => Uint8Array.from([...bytes, ...new Array(16).fill(0)]);
  assert.deepEqual(sniffDocumentType(pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), { mime: 'application/pdf', ext: 'pdf' });
  assert.deepEqual(
    sniffDocumentType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0])),
    { mime: 'image/webp', ext: 'webp' },
  );
  assert.equal(sniffDocumentType(pad([0x4d, 0x5a, 0x90, 0x00])), null); // a Windows executable renamed .pdf
});

test('public listing reads carry the agent tier only when documents were actually reviewed', () => {
  const src = readFileSync(path.join(process.cwd(), 'lib/listings.js'), 'utf8');
  assert.match(
    src,
    /CASE WHEN to_jsonb\(a\) ->> 'verification_level' IN \('verified', 'agency_partner'\)\s+THEN to_jsonb\(a\) ->> 'verification_level' END AS agent_verification_level/,
  );
});

test('no public or agent read references the new column directly (it would 500 before the migration runs)', () => {
  for (const file of ['lib/listings.js', 'lib/agents.js']) {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(src, /\ba\.verification_level\b/, `${file} must read verification_level through to_jsonb(a)`);
  }
});

test('verification documents are never exposed through a public URL', () => {
  const src = readFileSync(path.join(process.cwd(), 'lib/agentVerification.js'), 'utf8');
  assert.doesNotMatch(src, /getPublicUrl/);
  assert.match(src, /createSignedUrl/);
});

// ---------------------------------------------------------------------------
// Offline drafts
// ---------------------------------------------------------------------------

test('an untouched form is not a draft worth keeping', () => {
  assert.equal(isEmptyDraft({ fields: { title: '  ', purpose: '' }, photos: [] }), true);
  assert.equal(isEmptyDraft({ fields: { title: 'Villa' }, photos: [] }), false);
  assert.equal(isEmptyDraft({ fields: {}, photos: [{ name: 'a.jpg' }] }), false);
});

test('a network failure queues the draft; a server verdict does not', () => {
  assert.equal(looksOffline(new TypeError('Failed to fetch')), true);
  assert.equal(looksOffline(new TypeError('Load failed')), true);
  assert.equal(looksOffline(new Error('Not authenticated')), false);
});

test('the replay duplicate guard is scoped to the agent and a 24-hour window', async () => {
  enqueue([{ id: '512' }]);
  const id = await findRecentOwnDuplicate(7, { title: 'Villa Gombe', price: 1200 });
  assert.equal(id, 512);
  const sql = calls[calls.length - 1].sql;
  assert.match(sql, /p\.agent_id = \$2/);
  assert.match(sql, /interval '24 hours'/);
});

// ---------------------------------------------------------------------------
// Analytics rollup read path
// ---------------------------------------------------------------------------

test('per-listing totals read the rollup when it is fresh', async () => {
  enqueue([{ fresh: true }]);
  enqueue([{ listing_id: '286', views: 105, clicks: 4 }]);
  const stats = await getPerListingStats([286]);
  assert.match(calls[1].sql, /FROM listing_stats_daily/);
  assert.equal(stats.views['286'], 105);
  assert.equal(stats.clicks['286'], 4);
});

test('per-listing totals fall back to raw events when the rollup is stale or missing', async () => {
  enqueue([{ fresh: false }]);
  await getPerListingStats([286]);
  assert.match(calls[1].sql, /FROM page_views/);
  assert.ok(!calls.slice(1).some((c) => /listing_stats_daily/.test(c.sql)));
});

test('shared links carry a per-channel utm_source, and the untagged URL stays clean', () => {
  assert.equal(listingPublicUrl(305), 'https://lukkaplace.com/listings/305');
  assert.equal(listingPublicUrl(305, { source: SHARE_SOURCES.image }), 'https://lukkaplace.com/listings/305?utm_source=wa_status');
  assert.deepEqual(Object.values(SHARE_SOURCES), ['wa_status', 'wa_message', 'partage_agent']);
  for (const label of Object.values(SHARE_SOURCES)) assert.match(label, /^[a-z_]+$/);
});

test('the beacon forwards the landing utm_source — the endpoints accepted it but nothing sent it', () => {
  const client = readFileSync(path.join(process.cwd(), 'lib/analyticsClient.js'), 'utf8');
  assert.equal(client.match(/utmSource: landingUtmSource\(\)/g)?.length, 2);
});

test('the flyer is sent as a mozjpeg JPEG, with the PNG only as a fallback', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/compte/agent/biens/[id]/visuel/route.js'), 'utf8');
  assert.match(route, /jpeg\(\{ quality: FLYER_JPEG_QUALITY, mozjpeg: true \}\)/);
  assert.match(route, /const FLYER_JPEG_QUALITY = 85;/);
  assert.doesNotMatch(route, /^export const FLYER/m, 'a route file may only export handlers and route config');
});
