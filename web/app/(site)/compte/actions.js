'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentCustomerId, deleteCustomer, updateCustomerName } from '@/lib/customers';
import { cookies } from 'next/headers';
import { clearCustomerSession, forgetRememberedCustomerPhone } from '@/lib/customerSession';
import { revokeDevice } from '@/lib/pushNotifications';
import { PUSH_TOKEN_COOKIE } from '@/lib/pushRules';

/** In the app: this phone stops receiving this customer's alerts. Never blocks the logout. */
async function revokeThisPhone(customerId, reason) {
  const store = await cookies();
  const token = store.get(PUSH_TOKEN_COOKIE)?.value;
  if (!customerId || !token) return;
  try {
    await revokeDevice('customer', customerId, token, reason);
  } catch (err) {
    console.error(`[compte] push device revoke failed: ${err.message}`);
  }
  store.delete({ name: PUSH_TOKEN_COOKIE, path: '/' });
}

/**
 * Signs out THIS device only (2026-11-06). It used to bump token_version,
 * which also signed the customer out on their phone when they logged out on
 * a laptop — and every session ended meant another login. Ending every
 * session stays where it belongs: a password reset (customer or admin).
 * The remembered phone number stays, so signing back in is a password.
 */
export async function logoutAction() {
  await revokeThisPhone(await getCurrentCustomerId(), 'logout');
  await clearCustomerSession();
  redirect('/compte/connexion');
}

export async function updateNameAction(formData) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion');
  const fullName = String(formData.get('fullName') || '').trim();
  await updateCustomerName(customerId, fullName);
  revalidatePath('/compte');
}

export async function deleteAccountAction() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion');
  await revokeThisPhone(customerId, 'account deleted');
  await deleteCustomer(customerId); // cascades to customer_favorites/customer_saved_searches via FK
  await clearCustomerSession();
  await forgetRememberedCustomerPhone();
  redirect('/');
}
