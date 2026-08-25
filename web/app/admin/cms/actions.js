'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { updateSlider, updateAdvertisement } from '@/lib/cms';
import { setCdfRate } from '@/lib/currencyRate';

async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

export async function updateSliderAction(sliderId, formData) {
  await assertAdminSession();
  await updateSlider(sliderId, {
    title: String(formData.get('title') || ''),
    text: String(formData.get('text') || ''),
  });
  revalidatePath('/admin/cms');
}

export async function updateAdvertisementAction(adId, formData) {
  await assertAdminSession();
  await updateAdvertisement(adId, { url: String(formData.get('url') || '') });
  revalidatePath('/admin/cms');
}

/**
 * The USD→CDF display rate (web/CLAUDE.md: admin-editable, still explicitly
 * non-live — see lib/currencyRate.js's doc comment). `updated_by` is just
 * 'admin' — there's no per-admin identity in this single-shared-password
 * session model (lib/adminAuth.js), so attributing it to a named person
 * would be invented, not real.
 */
export async function updateExchangeRateAction(formData) {
  await assertAdminSession();
  const rate = Number(formData.get('cdf_per_usd'));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('cdf_per_usd must be a positive number');

  await setCdfRate(rate, 'admin');
  revalidatePath('/admin/cms');
  // 'layout' revalidates every route under app/(site)/layout.js, not just
  // one path — that layout is what reads the rate (see its own doc
  // comment), and the rate shows up on every public page with a <Price>.
  revalidatePath('/', 'layout');
}
