'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit, actorLabel } from '@/lib/adminAudit';
import { approveCredits, payApprovedCredits, syncReferralCredits, voidCredit } from '@/lib/referralCredits';
import { announceReferralProgram } from '@/lib/referralAnnouncement';

const PATH = '/admin/partenaires/agents';

function back(formData, flash, extra = {}) {
  const raw = String(formData.get('return_to') || '');
  const url = new URL(raw.startsWith(PATH) && !raw.startsWith('//') ? raw : PATH, 'http://console.local');
  url.searchParams.set('flash', flash);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value));
  return `${url.pathname}${url.search}`;
}

const idsFrom = (formData, name) => formData.getAll(name).map((v) => Number.parseInt(v, 10)).filter((n) => Number.isSafeInteger(n) && n > 0);

/** The same run the scheduler makes every morning (idempotent). */
export async function syncCreditsAction(formData) {
  const session = await requireAdmin('partners.payout');
  let result;
  try {
    result = await syncReferralCredits();
  } catch (err) {
    console.error(`[admin/referrals] sync failed: ${err.message}`);
    redirect(back(formData, 'failed'));
  }
  await recordAudit(session, { action: 'referrals.sync', details: result });
  revalidatePath(PATH);
  redirect(back(formData, result.available ? 'synced' : 'unavailable', { n: result.credited }));
}

/** Approves every credit past its 7-day hold, for the ticked agents or all of them. */
export async function approveCreditsAction(formData) {
  const session = await requireAdmin('partners.payout');
  const partnerIds = idsFrom(formData, 'partner_id');
  let n = 0;
  try {
    n = await approveCredits({ partnerIds, by: actorLabel(session) });
  } catch (err) {
    console.error(`[admin/referrals] approve failed: ${err.message}`);
    redirect(back(formData, 'failed'));
  }
  await recordAudit(session, { action: 'referrals.approve', details: { partnerIds, approved: n } });
  revalidatePath(PATH);
  redirect(back(formData, 'approved', { n }));
}

/** Pays the ticked agents' APPROVED credits: one payout per agent, linked to its credits. */
export async function payCreditsAction(formData) {
  const session = await requireAdmin('partners.payout');
  const partnerIds = idsFrom(formData, 'partner_id');
  if (!partnerIds.length) redirect(back(formData, 'pick'));
  const method = ['mobile_money', 'cash', 'bank'].includes(formData.get('method')) ? formData.get('method') : 'mobile_money';
  const reference = String(formData.get('reference') || '').trim().slice(0, 120) || null;
  let result;
  try {
    result = await payApprovedCredits({ partnerIds, method, reference, by: actorLabel(session) });
  } catch (err) {
    console.error(`[admin/referrals] pay failed: ${err.message}`);
    redirect(back(formData, 'failed'));
  }
  await recordAudit(session, { action: 'referrals.pay', details: { partnerIds, method, reference, ...result } });
  revalidatePath(PATH);
  redirect(back(formData, 'paid', { n: result.credits }));
}

/** A person's verdict that a customer is not real: void (unpaid) or flag for clawback (paid). */
export async function voidCreditAction(formData) {
  const session = await requireAdmin('partners.payout');
  const creditId = Number.parseInt(formData.get('credit_id'), 10);
  const reason = String(formData.get('reason') || '');
  if (!Number.isSafeInteger(creditId) || reason.trim().length < 5) redirect(back(formData, 'reason'));
  let outcome;
  try {
    outcome = await voidCredit({ creditId, reason, by: actorLabel(session) });
  } catch (err) {
    console.error(`[admin/referrals] void #${creditId} failed: ${err.message}`);
    redirect(back(formData, 'failed'));
  }
  await recordAudit(session, { action: `referrals.${outcome}`, details: { creditId, reason: reason.trim().slice(0, 300) } });
  revalidatePath(PATH);
  redirect(back(formData, outcome === 'unchanged' ? 'failed' : outcome));
}

/** The one-time programme announcement, up to 100 agents per press. */
export async function announceProgramAction(formData) {
  const session = await requireAdmin('partners.manage');
  let result;
  try {
    result = await announceReferralProgram();
  } catch (err) {
    console.error(`[admin/referrals] announcement failed: ${err.message}`);
    redirect(back(formData, 'failed'));
  }
  await recordAudit(session, { action: 'referrals.announce', details: result });
  revalidatePath(PATH);
  redirect(back(formData, result.available ? 'announced' : 'unavailable', { n: result.accepted, refused: result.refused, left: result.remaining }));
}
