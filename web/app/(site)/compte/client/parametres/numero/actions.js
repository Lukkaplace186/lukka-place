'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentCustomerId } from '@/lib/customers';
import { phoneFromForm } from '@/lib/phone';
import { requestPhoneChange, confirmPhoneChange, cancelPhoneChange } from '@/lib/customerPhoneChange';
import { establishCustomerSession, rememberCustomerPhone } from '@/lib/customerSession';

/**
 * "Changer de numéro" — both steps. The customer id always comes from the
 * session; the form only carries the new number (step 1) or the code (step 2).
 * Each returns a plain state for useActionState; a finished change redirects
 * to Paramètres, which says the new number.
 */

async function requireCustomerId() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte/client/parametres/numero');
  return customerId;
}

export async function sendPhoneChangeCodeAction(_prev, formData) {
  const customerId = await requireCustomerId();
  const phone = phoneFromForm(formData);
  if (!phone) return { step: 'phone', error: 'phone' };
  let result;
  try {
    result = await requestPhoneChange(customerId, phone);
  } catch (error) {
    console.error('[phone-change] request failed:', error.message);
    return { step: 'phone', error: 'failed' };
  }
  if (result.error === 'gone') redirect('/compte/connexion');
  if (!result.ok) return { step: result.error === 'send_failed' ? 'code' : 'phone', error: result.error, phone };
  revalidatePath('/compte/client/parametres/numero');
  return { step: 'code', phone: result.phone, sent: Date.now() };
}

export async function confirmPhoneChangeAction(_prev, formData) {
  const customerId = await requireCustomerId();
  const code = String(formData.get('code') || '').replace(/\D/g, '');
  if (code.length !== 6) return { step: 'code', error: 'invalid' };
  let result;
  try {
    result = await confirmPhoneChange(customerId, code);
  } catch (error) {
    console.error('[phone-change] confirm failed:', error.message);
    return { step: 'code', error: 'failed' };
  }
  if (!result.ok) {
    // No change waiting (or it expired, or too many tries): back to step 1.
    const restart = ['none', 'expired', 'too_many', 'taken'].includes(result.error);
    return { step: restart ? 'phone' : 'code', error: result.error };
  }
  // Every other session ended with the token_version bump; this device
  // stays signed in, and the login page now offers the new number.
  await establishCustomerSession({ id: customerId, tokenVersion: result.tokenVersion });
  await rememberCustomerPhone(result.phone);
  console.log(`[phone-change] customer ${customerId} moved from ${result.previousPhone} to ${result.phone}`);
  revalidatePath('/compte/client', 'layout');
  redirect('/compte/client/parametres?numero=change');
}

export async function cancelPhoneChangeAction() {
  const customerId = await requireCustomerId();
  await cancelPhoneChange(customerId);
  revalidatePath('/compte/client/parametres/numero');
  return { step: 'phone' };
}
