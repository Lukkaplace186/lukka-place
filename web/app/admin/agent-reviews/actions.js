'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { moderateAgentReview } from '@/lib/adminApi';

/** Only ever back into this page — a form field is not a redirect target taken unchecked. */
function returnPath(formData) {
  const raw = String(formData.get('return_to') || '');
  return raw.startsWith('/admin/agent-reviews') && !raw.startsWith('//') ? raw : '/admin/agent-reviews';
}

function withFlash(path, flash) {
  const url = new URL(path, 'http://console.local');
  url.searchParams.set('flash', flash);
  return `${url.pathname}${url.search}`;
}

/**
 * Publish or refuse a comment. The stars count either way: moderation decides
 * only whether the customer's words appear on the agent's public page.
 */
export async function moderateAgentReviewAction(formData) {
  const session = await requireAdmin('listings.moderate');
  const back = returnPath(formData);
  const id = Number.parseInt(formData.get('review_id'), 10);
  const status = String(formData.get('status') || '');
  const agentId = Number.parseInt(formData.get('agent_id'), 10);
  if (!Number.isFinite(id) || !['APPROVED', 'REJECTED'].includes(status)) redirect(withFlash(back, 'failed'));

  try {
    await moderateAgentReview(id, status);
  } catch (err) {
    console.warn(`[admin/agent-reviews] moderation of #${id} failed: ${err.message}`);
    redirect(withFlash(back, 'failed'));
  }

  // The comment text is never copied into the audit log.
  await recordAudit(session, {
    action: `agent_review.${status.toLowerCase()}`,
    entityType: 'agent',
    entityId: Number.isFinite(agentId) ? agentId : null,
    details: { reviewId: id },
  });

  revalidatePath('/admin/agent-reviews');
  if (Number.isFinite(agentId)) revalidatePath(`/agents/${agentId}`);
  redirect(withFlash(back, status === 'APPROVED' ? 'approved' : 'rejected'));
}
