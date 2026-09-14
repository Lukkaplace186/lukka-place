'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { updateSlider, updateAdvertisement } from '@/lib/cms';
import { setCdfRate } from '@/lib/currencyRate';

export async function updateSliderAction(sliderId, formData) {
  const session = await requireAdmin('cms.manage');
  const title = String(formData.get('title') || '');
  const text = String(formData.get('text') || '');
  await updateSlider(sliderId, { title, text });
  await recordAudit(session, { action: 'cms.slider', entityType: 'cms', entityId: `slider:${sliderId}`, details: { title } });
  revalidatePath('/admin/cms');
}

export async function updateAdvertisementAction(adId, formData) {
  const session = await requireAdmin('cms.manage');
  const url = String(formData.get('url') || '');
  await updateAdvertisement(adId, { url });
  await recordAudit(session, { action: 'cms.advertisement', entityType: 'cms', entityId: `ad:${adId}`, details: { url } });
  revalidatePath('/admin/cms');
}

/**
 * The USD→CDF display rate. `updated_by` now names the person who set it —
 * this column used to say only 'admin', because the console had one shared
 * password and no way to know who.
 */
export async function updateExchangeRateAction(formData) {
  const session = await requireAdmin('cms.manage');
  const rate = Number(formData.get('cdf_per_usd'));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('cdf_per_usd must be a positive number');

  await setCdfRate(rate, actorLabel(session).slice(0, 120));
  await recordAudit(session, { action: 'cms.exchange_rate', entityType: 'cms', entityId: 'exchange_rate', details: { cdfPerUsd: rate } });
  revalidatePath('/admin/cms');
  // 'layout' revalidates every route under app/(site)/layout.js, which reads the rate.
  revalidatePath('/', 'layout');
}
