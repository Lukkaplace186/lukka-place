import 'server-only';
import { mergeAnonymousData } from './customers';
import { establishCustomerSession, rememberCustomerPhone } from './customerSession';
import { claimRecentContactTaps } from './contactTapClaim';
import { recordAdEventFromAction } from './adServerContext';

/**
 * Signs in a customer account that was JUST created from a name and a number
 * (owner decision 2026-11-24: no WhatsApp step for a new number — sending a
 * code from WhatsApp lost one person in three). Used by "Continuer avec
 * WhatsApp" (app/(site)/compte/connexion/whatsappActions.js) and by the
 * request and visit forms (lib/guestAccount.js).
 *
 * Only ever for a number that had NO account a moment ago: a number that
 * already has one is someone else's until proven, and keeps the WhatsApp code
 * (or the password). The number is not marked confirmed (`phone_verified_at`
 * stays NULL), so what pays money — partner referral credits — still waits
 * for a real proof.
 *
 * The browser's own saved homes and searches come along (`localData`, from
 * components/LocalSavesFields.js), as with a password login. Nothing here
 * throws into the caller once the session is set: the account exists either way.
 *
 * @param {{id: number|string, token_version?: number, phone?: string}} customer
 * @param {{phone: string, localData?: {favoriteIds?: string[], savedSearches?: object[]}, source: string}} opts
 */
export async function signInNewCustomer(customer, { phone, localData = {}, source }) {
  const id = Number(customer.id);
  await establishCustomerSession({ id, tokenVersion: customer.token_version ?? 0 });
  try {
    await rememberCustomerPhone(phone);
    // This browser's WhatsApp taps of the last day are theirs (lib/contactTapClaim.js). Never throws.
    await claimRecentContactTaps(id);
    const favoriteIds = Array.isArray(localData?.favoriteIds) ? localData.favoriteIds.map(String).filter(Boolean).slice(0, 200) : [];
    const savedSearches = Array.isArray(localData?.savedSearches) ? localData.savedSearches.slice(0, 20) : [];
    if (favoriteIds.length || savedSearches.length) {
      try {
        await mergeAnonymousData(id, { favoriteIds, savedSearches });
      } catch (err) {
        console.error(`[new-account] merging this device's saved homes into #${id} failed: ${err.message}`);
      }
    }
    await recordAdEventFromAction({ name: 'CompleteRegistration', eventId: `reg-c-${id}`, phone: customer.phone || phone || null });
  } catch (err) {
    console.error(`[new-account] after signing in #${id}: ${err.message}`);
  }
  console.log(`[new-account] customer #${id} created and signed in from ${source} (number not confirmed)`);
}

/**
 * The two hidden fields components/LocalSavesFields.js fills on submit.
 *
 * @param {FormData} formData
 * @returns {{favoriteIds: string[], savedSearches: object[]}}
 */
export function localSavesFromForm(formData) {
  const raw = String(formData.get('favoriteIds') || '');
  const favoriteIds = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  let savedSearches = [];
  try {
    const parsed = JSON.parse(String(formData.get('savedSearches') || '[]'));
    if (Array.isArray(parsed)) savedSearches = parsed;
  } catch {
    savedSearches = [];
  }
  return { favoriteIds, savedSearches };
}
