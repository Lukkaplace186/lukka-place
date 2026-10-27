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
