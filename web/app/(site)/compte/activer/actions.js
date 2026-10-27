'use server';

import { redirect } from 'next/navigation';
import { normalizeStoredPhone } from '@/lib/phone';
import { hashPassword } from '@/lib/customerAuth';
import { establishCustomerSession } from '@/lib/customerSession';
import { consumeCustomerActivationToken } from '@/lib/customers';
import { recordAdEventFromAction } from '@/lib/adServerContext';

/**
 * Sets the first password of a customer account created on WhatsApp
 * (engine services/customerOnboarding.js) and signs them in. No code step:
 * the account exists because this number WhatsApped us, which already proved
 * it — the link's token protects the password, not the phone. Same shape as
 * /compte/agent/activer.
 */
export async function activateCustomerAction(formData) {
  const phone = normalizeStoredPhone(String(formData.get('phone') || ''));
  const token = String(formData.get('token') || '');
  const password = String(formData.get('password') || '');
  const confirm = String(formData.get('password_confirm') || '');
  const back = `/compte/activer?phone=${encodeURIComponent(phone || '')}&token=${encodeURIComponent(token)}`;

  if (!phone || !token) redirect(`${back}&error=invalid`);
  if (password.length < 8) redirect(`${back}&error=password`);
  if (password !== confirm) redirect(`${back}&error=mismatch`);

  const customer = await consumeCustomerActivationToken({ phone, token, passwordHash: hashPassword(password) });
  if (!customer) redirect(`${back}&error=invalid`);

  await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });
  await recordAdEventFromAction({ name: 'CompleteRegistration', eventId: `reg-c-${customer.id}`, phone });
  redirect('/compte/client?bienvenue=1');
}
