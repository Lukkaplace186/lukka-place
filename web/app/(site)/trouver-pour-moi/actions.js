'use server';

import { headers } from 'next/headers';
import { phoneFromForm } from '@/lib/phone';
import { demoCustomerPhoneOr } from '@/lib/demoAccounts';
import { createLead } from '@/lib/adminApi';
import { buildRequirementsSummary } from '@/lib/customerPortal';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { clientIpFrom } from '@/lib/salesReferral';
import { recordAdEventFromAction } from '@/lib/adServerContext';
import { moveStoryFr, parseMoveProject } from '@/lib/moveProjectRules';
import { openGuestAccount } from '@/lib/guestAccount';
import { OPEN_ACCOUNT_FIELD, accountRequested } from '@/lib/guestAccountRules';
import { localSavesFromForm } from '@/lib/newCustomerSession';
import {
  GUEST_REQUEST_SOURCE,
  createLimiter,
  guestTypeSummary,
  parseGuestRequest,
} from '@/lib/guestRequestRules';

// Per process (one PM2 fork). Five requests an hour from one connection, two
// a day for one number: a family sharing a phone can still ask twice, a loop
// cannot push the same number at agencies all day.
const ipLimited = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
const phoneLimited = createLimiter({ max: 2, windowMs: 24 * 60 * 60 * 1000 });

/**
 * A request left without an account (lib/guestRequestRules.js). The lead is
 * created exactly as the signed-in form creates one — POST /admin/leads, the
 * engine stores it and pushes it to the agencies covering the commune
 * (services/leadDispatch.js) — with the number the visitor typed as `wa_id`.
 *
 * That number is the visitor's claim, not a proven one: the signed-in form
 * uses a verified customer's phone. What limits the harm of a wrong or
 * someone else's number is what the agencies receive — a request to look at,
 * never a message sent to that number by us — plus the limits above and a
 * honeypot field a person never fills. If they open an account later with the
 * same number, the request appears in their Espace Client (it is found by
 * phone).
 *
 * Since 2026-11-24 the same name and number also open the person's free
 * account (the "Créer mon compte" box, ticked by default; lib/guestAccount.js)
 * once the lead is sent — no password, no session until they send the code
 * from that WhatsApp. `account` in the state says what the confirmation offers.
 *
 * Returns state for useActionState; never redirects, so the form can say
 * what happened in place.
 */
export async function submitGuestRequestAction(_prev, formData) {
  // Honeypot: hidden from people, filled by naive bots. Answer as if sent.
  if (String(formData.get('website') || '').trim()) {
    return { status: 'sent', last4: null };
  }

  // A signed-in demo customer always uses their demo number (lib/demoAccounts.js),
  // which the engine routes to the paired demo agent only.
  const phone = await demoCustomerPhoneOr(phoneFromForm(formData));
  if (!phone) return { status: 'error', code: 'phone' };

  let communes = [];
  try {
    communes = (await getLocationHierarchyWithFallback()).communes || [];
  } catch (err) {
    console.error(`[guest-request] commune list unavailable: ${err.message}`);
  }

  const parsed = parseGuestRequest(
    {
      transactionType: String(formData.get('transactionType') || ''),
      commune: String(formData.get('commune') || ''),
      propertyType: String(formData.get('propertyType') || ''),
      budgetMax: String(formData.get('budgetMax') || ''),
      bedrooms: String(formData.get('bedrooms') || ''),
      name: String(formData.get('name') || ''),
    },
    communes,
  );
  if (!parsed.ok) return { status: 'error', code: parsed.error };

  const ip = clientIpFrom(await headers()) || 'unknown';
  if (ipLimited(`ip:${ip}`) || phoneLimited(`phone:${phone}`)) {
    return { status: 'error', code: 'limit' };
  }

  const { request } = parsed;
  // City-wide ("Toute la ville", lib/guestRequestRules.js GUEST_CITY_WIDE):
  // no commune, the city's agencies are asked; the agency reads the city.
  const place = request.commune || `${request.city} (toute la ville)`;
  const base = buildRequirementsSummary({
    transactionType: request.transactionType,
    communes: [place],
    bedrooms: request.bedrooms ? String(request.bedrooms) : '',
    budgetMax: request.budgetMax ? String(request.budgetMax) : '',
  });
  const type = guestTypeSummary(request.propertyType);
  // "Votre situation" chips (2026-11-07): the reasons only, in the same
  // French brief the move projects use, story first on the agent's card.
  const { project: situation } = parseMoveProject({ reasons: String(formData.get('reasons') || '').split(',') });
  const story = moveStoryFr(situation);
  const criteria = [type, base, 'Demande envoyée sans compte depuis le site (numéro non vérifié).']
    .filter(Boolean)
    .join(' · ');
  const requirementsSummary = [story, criteria].filter(Boolean).join('\n');

  let leadId = null;
  try {
    const { lead } = await createLead({
      waId: phone,
      name: request.name,
      source: GUEST_REQUEST_SOURCE,
      requirementsSummary,
      transactionType: request.transactionType,
      commune: request.commune || undefined,
      communes: request.commune ? [request.commune] : [],
      city: request.city || undefined,
      priceMax: request.budgetMax,
      bedrooms: request.bedrooms,
      moveStory: story || undefined,
    });
    leadId = lead?.id ?? null;
  } catch (err) {
    console.error(`[guest-request] lead creation failed: ${err.message}`);
    return { status: 'error', code: 'send' };
  }

  console.log(`[guest-request] lead #${leadId} ${request.transactionType} ${request.commune}`);
  if (leadId) {
    await recordAdEventFromAction({ name: 'Lead', eventId: `lead-g-${leadId}`, phone });
  }
  // After the lead: the account step can only add, never cost the request.
  const account = await openGuestAccount({
    phone,
    name: request.name,
    entry: 'request',
    requested: accountRequested(formData.getAll(OPEN_ACCOUNT_FIELD)),
    localData: localSavesFromForm(formData),
  });
  return {
    status: 'sent',
    last4: phone.slice(-4),
    commune: request.commune || request.city,
    account: account.status === 'skipped' ? (account.reason === 'no_name' ? 'offer' : null) : account.status,
  };
}
