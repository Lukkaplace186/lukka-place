import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  VIDEO_PAYMENT_WARNING_FR, timeAtOffset, visitorClock, zoneCity, zoneOffsetMinutes,
} from '@/lib/visitMode';
import { VIDEO_PHRASE, requestedTimeWithMode, visitModeOf } from '@/lib/visitModeRules';
import { WHATSAPP_INTENTS, cleanWhatsAppIntent, contactIntentGroup, intentQuestionFr } from '@/lib/whatsappIntent';
import { RECORD_LEAD_CLICK_INTENT_SQL, recordLeadClick } from '@/lib/leadClicks';
import { LISTING_AVAILABILITY_SQL, videoVisitsFrom, EMPTY_AVAILABILITY } from '@/lib/agentAvailability';
import { normalizeSql } from '../support/fakePool.js';

// "Visite par appel vidéo" on the website (owner, 2026-11-16): a customer
// abroad asks the agent to show the property on a WhatsApp video call. The
// mode follows the app's rules (lib/visitModeRules.js, 2026-11-13).

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('the website uses the app’s rules: "video" or on site, the phrase once after the time', () => {
  assert.equal(visitModeOf('video'), 'video');
  assert.equal(visitModeOf(''), null);
  assert.equal(visitModeOf('in_person'), null);
  assert.equal(requestedTimeWithMode('mardi 18 novembre à 10h00', 'video'), `mardi 18 novembre à 10h00 ${VIDEO_PHRASE}`);
  assert.equal(requestedTimeWithMode(`mardi ${VIDEO_PHRASE}`, 'video'), `mardi ${VIDEO_PHRASE}`);
  // The engine adds the same words where it formats the time itself.
  assert.match(read('../services/visitMode.js'), new RegExp(`const VIDEO_PHRASE = '${VIDEO_PHRASE.replace(/[()]/g, '\\$&')}';`));
});

test('the visitor sees their own clock when it differs from the listing’s', () => {
  // 10:00 in Kinshasa (UTC+1) on 18 Nov 2026 = 09:00 UTC.
  const slot = '2026-11-18T10:00:00+01:00';
  assert.equal(timeAtOffset(slot, 1), '10:00');
  assert.equal(timeAtOffset(slot, 2), '11:00');

  assert.deepEqual(visitorClock(slot, { listingOffsetHours: 1, timeZone: 'America/New_York' }), { time: '04:00', city: 'New York', dayShift: 0 });
  assert.deepEqual(visitorClock(slot, { listingOffsetHours: 1, timeZone: 'Europe/London' }), { time: '09:00', city: 'London', dayShift: 0 });
  // Paris and Brussels are on Kinshasa's clock in November: nothing to add.
  assert.equal(visitorClock(slot, { listingOffsetHours: 1, timeZone: 'Europe/Paris' }), null);
  assert.equal(visitorClock(slot, { listingOffsetHours: 1, timeZone: 'Africa/Kinshasa' }), null);
  // …but not in summer (UTC+2).
  assert.deepEqual(visitorClock('2027-06-15T10:00:00+01:00', { listingOffsetHours: 1, timeZone: 'Europe/Brussels' }), { time: '11:00', city: 'Brussels', dayShift: 0 });
  // A Lubumbashi listing (UTC+2) seen from Kinshasa.
  assert.deepEqual(visitorClock(slot, { listingOffsetHours: 2, timeZone: 'Africa/Kinshasa' }), { time: '10:00', city: 'Kinshasa', dayShift: 0 });
  // The visitor's date moves: 20:00 Kinshasa is 04:00 the next day in Tokyo; 08:00 is 23:00 the day before in Los Angeles.
  assert.equal(visitorClock('2026-11-18T20:00:00+01:00', { listingOffsetHours: 1, timeZone: 'Asia/Tokyo' }).dayShift, 1);
  assert.equal(visitorClock('2026-11-18T08:00:00+01:00', { listingOffsetHours: 1, timeZone: 'America/Los_Angeles' }).dayShift, -1);
  // Unknown zone or instant: nothing, never a guess.
  assert.equal(visitorClock(slot, { listingOffsetHours: 1, timeZone: null }), null);
  assert.equal(visitorClock('not a date', { listingOffsetHours: 1, timeZone: 'Europe/London' }), null);
  assert.equal(zoneOffsetMinutes('Not/AZone', new Date()), null);
  assert.equal(zoneCity('America/New_York'), 'New York');
});

test('the owner’s payment warning is the exact sentence, on every video surface', () => {
  assert.equal(VIDEO_PAYMENT_WARNING_FR, 'Ne versez aucun argent sur la seule base d’une vidéo.');
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  assert.equal(fr.enquiry.visitMode.warning, VIDEO_PAYMENT_WARNING_FR);
  assert.equal(fr.listings.waIntent.visitMode.warning, VIDEO_PAYMENT_WARNING_FR);
  assert.match(fr.account.visits.detail.videoConfirmed, /Ne versez aucun argent sur la seule base d’une vidéo\./);
  assert.match(read('components/VisitRequestDialog.js'), /enquiry\.visitMode\.warning/);
  assert.match(read('components/WhatsAppIntentSheet.js'), /listings\.waIntent\.visitMode\.warning/);
  assert.match(read('components/EnquiryCard.js'), /enquiry\.visitMode\.warning/);
});

test('the WhatsApp chooser’s video visit is its own intent and counts as a visit', () => {
  assert.ok(WHATSAPP_INTENTS.includes('video_visit'));
  assert.equal(cleanWhatsAppIntent('video_visit'), 'video_visit');
  assert.equal(contactIntentGroup('video_visit'), 'visit');
  // The engine reads this sentence back (services/listingEnquiry.js enquiryIntent).
  assert.match(intentQuestionFr('video_visit'), /^Je souhaite visiter ce bien par appel vidéo WhatsApp\./);
  const sheet = read('components/WhatsAppIntentSheet.js');
  assert.match(sheet, /intent === 'visit' && videoOffered/, 'the second step only when the agent takes video visits');
  assert.match(sheet, /data\?\.videoVisits === true/, 'unknown is no second step');
});

test('before the migration, a video-visit tap is kept as a visit (23514)', async () => {
  const seen = [];
  const pool = {
    async query(text, values) {
      seen.push({ text, values });
      if (seen.length === 1) throw Object.assign(new Error('violates check constraint'), { code: '23514' });
      return { rowCount: 1, rows: [] };
    },
  };
  const ok = await recordLeadClick(pool, {
    listingId: 7, commune: 'Gombe', device: 'mobile', source: 'direct', price: 500, routingType: 'DIRECT_WA', visitorId: 'v1', intent: 'video_visit',
  });
  assert.equal(ok, true);
  assert.equal(seen.length, 2);
  assert.equal(normalizeSql(seen[1].text), normalizeSql(RECORD_LEAD_CLICK_INTENT_SQL));
  assert.equal(seen[0].values.at(-1), 'video_visit');
  assert.equal(seen[1].values.at(-1), 'visit');
});

test('the agent’s switch is on unless they turned it off, and read safely before the migration', () => {
  assert.equal(EMPTY_AVAILABILITY.videoVisits, true);
  assert.equal(videoVisitsFrom(undefined), true);
  assert.equal(videoVisitsFrom(null), true);
  assert.equal(videoVisitsFrom('true'), true);
  assert.equal(videoVisitsFrom('false'), false);
  assert.equal(videoVisitsFrom(false), false);
  assert.match(normalizeSql(LISTING_AVAILABILITY_SQL), /to_jsonb\(v\) ->> 'video_visits'/);
  assert.doesNotMatch(LISTING_AVAILABILITY_SQL, /v\.video_visits/, 'a plain column would 42703 before the migration');
  // The public gate is still on the listing asked about.
  assert.match(LISTING_AVAILABILITY_SQL, /p\.status = 1 AND p\.approve_status = 1/);
});

test('the dialog posts "video" or nothing; the action refuses a video visit the agent does not take', () => {
  const dialog = read('components/VisitRequestDialog.js');
  assert.match(dialog, /name="visit_mode" value=\{videoOffered && mode === 'video' \? 'video' : ''\}/);
  const action = read('app/(site)/listings/[id]/actions.js');
  assert.match(action, /const visitMode = visitModeOf\(formData\.get\('visit_mode'\)\);/);
  assert.match(action, /visitMode === 'video' && !\(await getListingAvailability\(listing\.id\)\)\.videoVisits\) \{\s*redirect\(`\$\{base\}\?visit_error=video`\);/);
  assert.match(action, /createViewingRequest\(\{[^}]*visitMode \}\)/);
  // The confirmation reads the action's own redirect (&mode=video).
  assert.match(action, /'&mode=video'/);
  assert.match(read('app/(site)/listings/[id]/page.js'), /sp\.mode === 'video'/);
});
