'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentCustomerId, bumpTokenVersion, deleteCustomer, updateCustomerName } from '@/lib/customers';
import { clearCustomerSession } from '@/lib/customerSession';

export async function logoutAction() {
  const customerId = await getCurrentCustomerId();
  if (customerId) await bumpTokenVersion(customerId); // invalidates any other outstanding session for this account too
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
  redirect('/');
}
