'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { saveFeatureFlags, saveSocialLinks } from '@/lib/siteSettings';
import { FEATURE_FLAGS, SOCIAL_NETWORKS, UNHIDEABLE_ADMIN_TABS, validateSocialUrl } from '@/lib/siteSettingsRules';
import { ADMIN_NAV_HREFS } from '@/lib/adminNav';
import { getT } from '@/lib/i18n/server';

/**
 * Footer social links. Every network is validated (https, its own host);
 * one bad field refuses the whole save and names the field, so a half-saved
 * form never publishes.
 * @returns {Promise<{ok: true, message: string} | {ok: false, error: string, field?: string}>}
 */
export async function saveSocialLinksAction(formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('cms.manage');
    const links = {};
    for (const { key, label } of SOCIAL_NETWORKS) {
      const check = validateSocialUrl(key, formData.get(key));
      if (!check.ok) return { ok: false, field: key, error: t(`admin.settings.social.errors.${check.error}`, { network: label }) };
      if (check.value) links[key] = check.value;
    }
    await saveSocialLinks(links, actorLabel(session).slice(0, 120));
    await recordAudit(session, { action: 'settings.social_links', entityType: 'cms', entityId: 'site.social_links', details: links });
    revalidatePath('/admin/settings');
    revalidatePath('/', 'layout');
    return { ok: true, message: t('admin.settings.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/**
 * "Onglets et sections": the site / agent-portal switches (FEATURE_FLAGS) and
 * which console tabs show in the sidebar. A tab checkbox is named
 * `tab:<href>` and ticked = visible, so a tab added to the console later is
 * visible until someone hides it. Only known hrefs are stored.
 */
export async function saveFeatureFlagsAction(formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('cms.manage');
    const flags = {};
    for (const { key } of FEATURE_FLAGS) flags[key] = formData.get(key) === 'on';
    flags.hiddenAdminTabs = ADMIN_NAV_HREFS.filter((href) => !UNHIDEABLE_ADMIN_TABS.includes(href) && formData.get(`tab:${href}`) !== 'on');
    await saveFeatureFlags(flags, actorLabel(session).slice(0, 120));
    await recordAudit(session, { action: 'settings.features', entityType: 'cms', entityId: 'site.features', details: flags });
    revalidatePath('/admin/settings');
    revalidatePath('/', 'layout');
    return { ok: true, message: t('admin.settings.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
