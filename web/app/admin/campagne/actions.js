'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { saveReferralCampaign } from '@/lib/siteSettings';

/**
 * Stop or restart the agent announcement campaign from the Campagne tab. The
 * same switch as /admin/partenaires/agents' button (cms_settings
 * growth.referral_campaign); it sends nothing itself.
 */
export async function setCampaignAction(formData) {
  const session = await requireAdmin('partners.manage');
  const active = formData.get('active') === '1';
  try {
    await saveReferralCampaign(active, actorLabel(session).slice(0, 120));
  } catch (err) {
    console.error(`[admin/campagne] campaign switch failed: ${err.message}`);
    redirect('/admin/campagne?flash=failed');
  }
  await recordAudit(session, {
    action: active ? 'referrals.campaign_start' : 'referrals.campaign_stop',
    entityType: 'cms',
    entityId: 'growth.referral_campaign',
  });
  revalidatePath('/admin/campagne');
  revalidatePath('/admin/partenaires/agents');
  redirect(`/admin/campagne?flash=${active ? 'campaignStarted' : 'campaignStopped'}`);
}
