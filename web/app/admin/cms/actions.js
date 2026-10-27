'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { updateAdvertisement } from '@/lib/cms';
import { validateAdUrl } from '@/lib/cmsAdRules';
import { saveSeoSettings } from '@/lib/siteSettings';
import { validateSeoInput } from '@/lib/siteSettingsRules';
import { setCdfRate } from '@/lib/currencyRate';
import { clearHeroSettings, getHeroSettings, saveHeroSettings } from '@/lib/cmsSettings';
import { HERO_MAX_UPLOAD_BYTES, HERO_UPLOAD_TYPES, allowedHeroUrl, validateHeroText } from '@/lib/cmsHeroRules';
import { uploadCmsImage } from '@/lib/listingStorage';
import { getT } from '@/lib/i18n/server';

/**
 * A banner's click-through URL. '' clears it; anything that is not an
 * http(s) address is refused (lib/cmsAdRules.js validateAdUrl).
 */
export async function updateAdvertisementAction(adId, formData) {
  const session = await requireAdmin('cms.manage');
  const check = validateAdUrl(formData.get('url'));
  if (!check.ok) throw new Error((await getT())(`admin.cms.ads.errors.${check.error}`));
  const url = check.value;
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

/**
 * The homepage hero image, from the "Gestion visuelle" section. One of: an
 * uploaded file (resized to 2400 px wide JPEG when sharp is available, so the
 * homepage does not ship a camera original), a pasted URL on an allowed image
 * host, or `reset` for the built-in photo. Live on the next request.
 * @returns {Promise<{ok: true, message: string, hero: object|null} | {ok: false, error: string}>}
 */
export async function saveHeroAction(formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('cms.manage');
    if (formData.get('reset') === '1') {
      await clearHeroSettings();
      await recordAudit(session, { action: 'cms.hero_reset', entityType: 'cms', entityId: 'home.hero' });
      revalidatePath('/admin/cms');
      revalidatePath('/');
      return { ok: true, message: t('admin.cms.hero.resetDone'), hero: null };
    }

    const text = validateHeroText({ alt: formData.get('alt'), credit: formData.get('credit') });
    if (text.errorKey) return { ok: false, error: t(text.errorKey) };

    let imageUrl = null;
    const file = formData.get('image');
    if (file && typeof file !== 'string' && file.size > 0) {
      const ext = HERO_UPLOAD_TYPES[file.type];
      if (!ext) return { ok: false, error: t('admin.cms.hero.badType') };
      if (file.size > HERO_MAX_UPLOAD_BYTES) return { ok: false, error: t('admin.cms.hero.tooLarge', { max: 10 }) };
      let buffer = Buffer.from(await file.arrayBuffer());
      let finalExt = ext;
      try {
        const { default: sharp } = await import('sharp');
        buffer = await sharp(buffer).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
        finalExt = 'jpg';
      } catch (err) {
        console.error(`[cms] hero resize skipped, uploading the original: ${err.message}`);
      }
      imageUrl = await uploadCmsImage(buffer, finalExt);
    } else if (String(formData.get('image_url') || '').trim()) {
      imageUrl = allowedHeroUrl(formData.get('image_url'));
      if (!imageUrl) return { ok: false, error: t('admin.cms.hero.badUrl') };
    } else {
      // Only the alt text or the credit changed: keep the picture already set.
      imageUrl = (await getHeroSettings())?.imageUrl || null;
      if (!imageUrl) return { ok: false, error: t('admin.cms.hero.chooseImage') };
    }
    if (!allowedHeroUrl(imageUrl)) return { ok: false, error: t('admin.cms.hero.badUrl') };

    const hero = { imageUrl, ...text.values };
    await saveHeroSettings(hero, actorLabel(session).slice(0, 200));
    await recordAudit(session, { action: 'cms.hero', entityType: 'cms', entityId: 'home.hero', details: hero });
    revalidatePath('/admin/cms');
    revalidatePath('/');
    return { ok: true, message: t('admin.cms.hero.saved'), hero };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/**
 * "Optimisation SEO & Meta": the default site title, meta description (per
 * language) and Open Graph image, stored as cms_settings `site.seo`. One bad
 * field refuses the whole save and names it. Live on the next request: the
 * memo is dropped on save and every layout is revalidated.
 * @returns {Promise<{ok: true, message: string} | {ok: false, error: string, field?: string}>}
 */
export async function saveSeoSettingsAction(formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('cms.manage');
    const check = validateSeoInput(formData);
    if (!check.ok) return { ok: false, field: check.field, error: t(`admin.cms.seo.errors.${check.error}`) };
    await saveSeoSettings(check.value, actorLabel(session).slice(0, 120));
    await recordAudit(session, { action: 'cms.seo', entityType: 'cms', entityId: 'site.seo', details: check.value });
    revalidatePath('/admin/cms');
    revalidatePath('/', 'layout');
    return { ok: true, message: t('admin.cms.seo.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
