'use server';

import { headers } from 'next/headers';
import { normalizeStoredPhone } from '@/lib/phone';
import { clientKey, rateLimited } from '@/lib/eventIngest';
import { openGuestAccount } from '@/lib/guestAccount';
import { demoCustomerPhoneOr } from '@/lib/demoAccounts';

const STARTS_PER_10_MIN = 10;

/**
 * The account box in the WhatsApp sheet's visit step (components/WhatsAppIntentSheet.js,
 * 2026-11-24, owner: the WhatsApp tap is the most engaged moment and it went
 * to the agent with no account — 141 people in 14 days, one had one). The
 * name and number the customer already typed there open the account as the
 * request and visit forms do (lib/guestAccount.js): a new number is signed in
 * at once, with the "homes like this one" alert saved; a known number is not
 * (the code screen, offered when they come back from WhatsApp).
 *
 * Called WITHOUT waiting: WhatsApp opens in the same tap, and this finishes
 * while they write to the agent; the session cookie is there when they come
 * back. Never throws.
 *
 * @param {{name: string, phone: string, alert?: {query: string, label: string}|null,
 *   localData?: {favoriteIds?: string[], savedSearches?: object[]}}} input
 * @returns {Promise<{status: 'created'|'existing'|'skipped'}>}
 */
export async function openAccountFromWhatsAppSheetAction(input = {}) {
  try {
    const key = clientKey({ headers: await headers() });
    if (rateLimited(`wa-sheet-account:${key}`, STARTS_PER_10_MIN)) return { status: 'skipped' };
    const typed = normalizeStoredPhone(String(input.phone || ''));
    if (!typed) return { status: 'skipped' };
    // A demo customer's own number, whatever was typed (lib/demoAccounts.js).
    const phone = await demoCustomerPhoneOr(typed);
    const alert = input.alert && typeof input.alert.query === 'string' && typeof input.alert.label === 'string'
      ? { query: input.alert.query.slice(0, 500), label: input.alert.label.slice(0, 120) }
      : null;
    const local = input.localData || {};
    const savedSearches = [...(alert ? [alert] : []), ...(Array.isArray(local.savedSearches) ? local.savedSearches : [])];
    const result = await openGuestAccount({
      phone,
      name: String(input.name || '').slice(0, 80),
      entry: 'wa_sheet',
      requested: true,
      localData: { favoriteIds: Array.isArray(local.favoriteIds) ? local.favoriteIds : [], savedSearches },
    });
    return { status: result.status };
  } catch (err) {
    console.error(`[wa-sheet-account] ${err.message}`);
    return { status: 'skipped' };
  }
}
