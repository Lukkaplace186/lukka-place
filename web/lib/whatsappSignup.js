import { normaliseReferralCode } from './launchCommission';

/**
 * "Créer mon compte via WhatsApp" (growth plan item 23): the wa.me link that
 * opens WhatsApp with the message the engine recognises
 * (services/customerOnboarding.js — it must START with "Inscription Lukka
 * Place"; the code is read from "Code : NADIA01"). Never the word
 * "parrainage": that is the sales reps' wording, handled elsewhere.
 * Null when the business number is not configured.
 */
export function whatsappSignupText(code = null) {
  const clean = normaliseReferralCode(code);
  return clean ? `Inscription Lukka Place — Code : ${clean}` : 'Inscription Lukka Place';
}

export function whatsappSignupLink(code = null, businessNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER) {
  const digits = String(businessNumber ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(whatsappSignupText(code))}` : null;
}

/**
 * The AGENT's "S'inscrire sur WhatsApp" (agent signup page, 2026-11-04). An
 * agent account is created on WhatsApp by sending a first listing
 * (services/agentOnboarding.js), so this message only has to get the agent
 * the instructions, and the engine already answers it without a model call:
 *
 * - without a code it reads as a signup question (services/quickReplies.js
 *   SIGNUP_PATTERN: "inscri", no digit, nothing naming a property or a price)
 *   and gets SIGNUP_REPLY — "2 mois gratuits", send your first listing;
 * - with a SALES REP's code it reads as a referral (services/salesReferral.js
 *   REFERRAL_PHRASE, "Code parrainage : JEAN01"): the code is remembered for
 *   the account the first listing creates, and the reply says the same thing.
 *
 * It must never start with "Inscription Lukka Place": that is the CUSTOMER
 * signup the engine turns straight into a customer account. A partner's code
 * is not passed — salesReferral only knows reps and would answer "code
 * inconnu". The engine's matchers are pinned against this text in
 * tests/unit/agent-signup-page.test.js.
 */
export function agentWhatsappSignupText(repCode = null) {
  const clean = normaliseReferralCode(repCode);
  const base = 'Bonjour, je suis agent immobilier et je veux m’inscrire sur Lukka Place.';
  return clean ? `${base} Code parrainage : ${clean}` : base;
}

export function agentWhatsappSignupLink(repCode = null, businessNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER) {
  const digits = String(businessNumber ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(agentWhatsappSignupText(repCode))}` : null;
}
