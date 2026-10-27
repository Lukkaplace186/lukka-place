'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { saveGrowthSettings } from '@/lib/siteSettings';
import { parseGrowthForm } from '@/lib/growthSettingsRules';

/**
 * "Croissance": the Meta / TikTok pixel ids and the founder cutoff
 * (lib/growthSettingsRules.js). The access tokens for server events are never
 * typed here — they stay in the server environment.
 */
export async function saveGrowthSettingsAction(formData) {
  const session = await requireAdmin('cms.manage');
  const parsed = parseGrowthForm(Object.fromEntries(formData));
  if (!parsed.ok) redirect(`/admin/settings?growth_error=${parsed.error}#croissance`);
  try {
    await saveGrowthSettings(parsed.value, actorLabel(session).slice(0, 120));
  } catch (err) {
    console.error(`[admin/settings] growth settings failed: ${err.message}`);
    redirect('/admin/settings?growth_error=failed#croissance');
  }
  await recordAudit(session, { action: 'settings.growth', entityType: 'cms', entityId: 'site.growth', details: parsed.value });
  revalidatePath('/admin/settings');
  revalidatePath('/', 'layout');
  redirect('/admin/settings?growth_saved=1#croissance');
}
