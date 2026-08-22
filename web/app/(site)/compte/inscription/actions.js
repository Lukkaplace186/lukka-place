'use server';

import { redirect } from 'next/navigation';
import { normalizeCongoPhone } from '@/lib/phone';
import { getCustomerByPhone, createCustomer, mergeAnonymousData } from '@/lib/customers';
import { hashPassword } from '@/lib/customerAuth';
import { establishCustomerSession } from '@/lib/customerSession';

function safeNext(nextParam) {
  const next = String(nextParam || '/compte');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/compte';
}

function parseAnonymousData(formData) {
  const favoriteIdsRaw = String(formData.get('favoriteIds') || '');
  const favoriteIds = favoriteIdsRaw ? favoriteIdsRaw.split(',').filter(Boolean) : [];
  let savedSearches = [];
  try {
    savedSearches = JSON.parse(String(formData.get('savedSearches') || '[]'));
  } catch {
    savedSearches = [];
  }
  return { favoriteIds, savedSearches };
}

export async function signupAction(formData) {
  const next = safeNext(formData.get('next'));
  const password = String(formData.get('password') || '');
  const fullName = String(formData.get('fullName') || '').trim();
  const phone = normalizeCongoPhone(String(formData.get('phone') || ''));

  if (!phone) {
    redirect(`/compte/inscription?error=phone&next=${encodeURIComponent(next)}`);
  }

  // Minimal length check, no policy engine — matches this app's low-ceremony
  // posture (adminAuth.js has no password policy either).
  if (password.length < 8) {
    redirect(`/compte/inscription?error=password&next=${encodeURIComponent(next)}`);
  }

  const existing = await getCustomerByPhone(phone);
  if (existing) {
    redirect(`/compte/inscription?error=exists&next=${encodeURIComponent(next)}`);
  }

  const customer = await createCustomer({ phone, passwordHash: hashPassword(password), fullName });

  const { favoriteIds, savedSearches } = parseAnonymousData(formData);
  if (favoriteIds.length > 0 || savedSearches.length > 0) {
    await mergeAnonymousData(customer.id, { favoriteIds, savedSearches });
  }

  await establishCustomerSession({ id: customer.id, tokenVersion: customer.token_version });

  redirect(next);
}
