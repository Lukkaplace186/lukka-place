'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { POST_TEXT_MAX, cleanPostUrl, extractCongoPhones } from '@/lib/facebookLeadParser';
import { recordFacebookProspects } from '@/lib/facebookProspects';
import { getT } from '@/lib/i18n/server';

/**
 * "Coller une publication": a team member pastes a Facebook group post they
 * can see as a member; the numbers in it become agent prospects. Same parser
 * and same write as POST /api/ingest/facebook-lead. The text is re-parsed
 * here — the browser's live preview is never trusted.
 *
 * The audit row records counts and the group, never the post text or the
 * numbers (they are people's, and the table already holds them).
 */
export async function pasteFacebookPostAction(formData) {
  const t = await getT();
  let session;
  try {
    session = await requireAdmin('agents.manage');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const postText = String(formData.get('post_text') || '');
  if (!postText.trim()) return { ok: false, error: t('admin.facebookProspects.errorEmpty') };
  if (postText.length > POST_TEXT_MAX) return { ok: false, error: t('admin.facebookProspects.errorTooLong', { max: POST_TEXT_MAX }) };

  const rawUrl = String(formData.get('post_url') || '').trim();
  const postUrl = cleanPostUrl(rawUrl);
  if (rawUrl && !postUrl) return { ok: false, error: t('admin.facebookProspects.errorUrl') };

  const phones = extractCongoPhones(postText);
  if (!phones.length) return { ok: true, found: 0, created: [], skipped: [] };

  const groupName = String(formData.get('group_name') || '');
  let result;
  try {
    result = await recordFacebookProspects({
      phones,
      authorName: String(formData.get('author_name') || ''),
      groupName,
      postUrl,
      postText,
    });
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, error: t('admin.facebookProspects.errorUnavailable') };
    console.error(`[admin/prospects] paste failed: ${err.message}`);
    return { ok: false, error: t('errors.actionFailed') };
  }

  await recordAudit(session, {
    action: 'prospects.facebook_paste',
    entityType: 'facebook_prospect',
    details: { group: groupName.trim().slice(0, 120) || null, found: phones.length, created: result.created.length, skipped: result.skipped.length },
  });
  revalidatePath('/admin/prospects/paste');
  return { ok: true, found: phones.length, ...result };
}
