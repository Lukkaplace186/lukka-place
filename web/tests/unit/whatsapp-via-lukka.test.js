import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { contactWhatsAppHref, routesViaLukka } from '@/lib/leadRouting';
import { LEAD_CLICK_ROUTING_TYPES } from '@/lib/leadClicks';
import { mergeInteractionCounts } from '@/lib/interactionCounts';

// 2026-11-09, owner decision: every "write to this agent" WhatsApp button
// (listing, profile, directory, project, Espace Client) opens the Lukka Place
// number with the page's link; the engine records the customer and hands them
// the agent's WhatsApp. NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT=on restores the
// agent's own number.

const root = path.resolve(import.meta.dirname, '..', '..');
const CENTRAL = '243899000000';
const textOf = (href) => decodeURIComponent(href.split('?text=')[1]);

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = CENTRAL;
  delete process.env.NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT;
});

test('a contact button goes to our number with the page link last', () => {
  assert.equal(routesViaLukka(), true);
  const href = contactWhatsAppHref({ agentPhone: '243821122937', message: 'Bonjour', link: 'https://lukkaplace.com/agents/43' });
  assert.ok(href.startsWith(`https://wa.me/${CENTRAL}?text=`), href);
  assert.equal(textOf(href), 'Bonjour\n\nhttps://lukkaplace.com/agents/43');
});

test('the switch restores the agent\'s own number; no central number means the agent\'s', () => {
  process.env.NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT = 'on';
  assert.ok(contactWhatsAppHref({ agentPhone: '243821122937', message: 'x', link: null }).startsWith('https://wa.me/243821122937?'));
  delete process.env.NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT;
  delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  assert.equal(routesViaLukka(), false);
  assert.ok(contactWhatsAppHref({ agentPhone: '243821122937', message: 'x', link: null }).startsWith('https://wa.me/243821122937?'));
  assert.equal(contactWhatsAppHref({ agentPhone: null, message: 'x', link: null }), null);
});

test('a VIA_LUKKA tap is stored, allowed by its migration, and not counted twice', () => {
  assert.ok(LEAD_CLICK_ROUTING_TYPES.includes('VIA_LUKKA'));
  const migration = readFileSync(path.join(root, '..', 'migrations', '20261109_whatsapp_via_lukka.sql'), 'utf8');
  assert.match(migration, /'DIRECT_WA', 'CENTRAL_FALLBACK', 'VIA_LUKKA'/);
  const merged = mergeInteractionCounts({
    taps: [{ agentId: 43, routingType: 'VIA_LUKKA', count: 5 }],
    calls: [],
    engine: { leads: [{ source: 'listing-whatsapp-enquiry', agentId: 43, count: 2, contacted: 1 }], viewings: [] },
    chats: [],
  });
  const row = merged.agents.find((a) => String(a.agentId) === '43');
  assert.equal(row.channels.whatsappDirect || 0, 0, 'the tap is not an interaction of its own');
  assert.equal(row.channels.whatsappEnquiry, 2, 'the message it led to is');
});

test('every contact surface builds its link through contactWhatsAppHref', () => {
  for (const file of [
    'app/(portfolio)/agents/[id]/page.js',
    'app/(portfolio)/agents/page.js',
    'components/projects/ProjectEnquiryCard.js',
    'app/(site)/compte/client/visites/VisitCard.js',
    'app/(site)/compte/client/messages/InquiryThreads.js',
  ]) {
    const src = readFileSync(path.join(root, file), 'utf8');
    assert.match(src, /contactWhatsAppHref\(/, file);
  }
});
