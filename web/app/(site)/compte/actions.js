'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentCustomerId, deleteCustomer, updateCustomerName } from '@/lib/customers';
import { clearCustomerSession, forgetRememberedCustomerPhone } from '@/lib/customerSession';

/**
 * Signs out THIS device only (2026-11-06). It used to bump token_version,
 * which also signed the customer out on their phone when they logged out on
 * a laptop — and every session ended meant another login. Ending every
 * session stays where it belongs: a password reset (customer or admin).
 * The remembered phone number stays, so signing back in is a password.
 */
export async function logoutAction() {
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
  await deleteCustomer(customerId); // cascades to customer_favorites/customer_saved_searches via FK
  await clearCustomerSession();
  await forgetRememberedCustomerPhone();
  redirect('/');
}
