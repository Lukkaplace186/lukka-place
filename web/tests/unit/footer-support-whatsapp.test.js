import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSupportWhatsAppHref, SUPPORT_WHATSAPP_NUMBER } from '@/lib/whatsapp';

// Owner, 2026-11-11: the footer's WhatsApp icon goes to customer service
// (+243 846 962 654), not the intake number the listing buttons use.
test('footer WhatsApp opens the customer service number', () => {
  const saved = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER;
  delete process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER;
  try {
    assert.equal(SUPPORT_WHATSAPP_NUMBER, '243846962654');
    assert.match(getSupportWhatsAppHref('Bonjour'), /^https:\/\/wa\.me\/243846962654\?text=Bonjour/);
  } finally {
    if (saved !== undefined) process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER = saved;
  }
  const footer = readFileSync(new URL('../../components/Footer.js', import.meta.url), 'utf8');
  assert.match(footer, /getSupportWhatsAppHref\(t\('footer\.whatsappGreeting'\)\)/);
  assert.doesNotMatch(footer, /getCentralWhatsAppHref/);
});
