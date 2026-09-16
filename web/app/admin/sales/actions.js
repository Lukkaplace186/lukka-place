'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { kinshasaDayStart } from '@/lib/adminPagination';
import { normaliseCurrency, parseAmount, validatePlanInput, validateRepInput } from '@/lib/salesRules';
import {
  addCommissionAdjustment, approveCommissions, assignAgentsToRep, endRepAssignment, recordSalesPayout,
  saveSalesPlan, saveSalesRep, syncSalesCommissions, voidCommission,
} from '@/lib/sales';
import { suggestReferralCode } from '@/lib/launchCommission';
import {
  excludeListingCredit, listReferralCodes, overrideAttribution, setAttributionValidation,
} from '@/lib/salesLaunch';
import { getT } from '@/lib/i18n/server';

/**
 * Every write on /admin/sales. `sales.manage` (owner, finance) for all of them —
 * a rep never approves, adjusts or pays their own commissions — and each one
 * audited against the rep it touched.
 */

function adminIdOf(session) {
  return session?.shared ? null : session?.id ?? null;
}

function positiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function refresh(repId) {
  revalidatePath('/admin/sales');
  if (repId) revalidatePath(`/admin/sales/${repId}`);
}

async function guarded(t, work) {
  try {
    const session = await requireAdmin('sales.manage');
    return await work(session);
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

function todayInKinshasa() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function syncCommissionsAction() {
  const t = await getT();
  return guarded(t, async (session) => {
    const counts = await syncSalesCommissions();
    await recordAudit(session, { action: 'sales.sync', details: counts });
    refresh();
    return { ok: true, message: `${t('admin.sales.synced', counts)} ${t('admin.sales.launch.synced', counts)}` };
  });
}

export async function saveRepAction(repId, formData) {
  const t = await getT();
  return guarded(t, async (session) => {
    const existing = repId ? positiveInt(repId) : null;
    const checked = validateRepInput({
      fullName: formData.get('full_name'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      planId: formData.get('plan_id'),
      status: formData.get('status'),
      adminUserId: formData.get('admin_user_id'),
      referralCode: formData.get('referral_code'),
    });
    if (checked.errorKey) return { ok: false, error: t(checked.errorKey) };
    // A new rep with no code typed gets one from their name (JEAN01, JEAN02 …).
    if (!existing && !checked.values.referralCode) {
      checked.values.referralCode = suggestReferralCode(checked.values.fullName, await listReferralCodes());
    }
    const result = await saveSalesRep(existing, checked.values, { adminId: adminIdOf(session) });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: existing ? 'sales.rep_update' : 'sales.rep_create',
      entityType: 'sales_rep',
      entityId: result.id,
      details: { ...checked.values, phone: checked.values.phone ? 'set' : null },
    });
    refresh(result.id);
    return { ok: true, id: result.id, message: t(existing ? 'admin.sales.reps.updated' : 'admin.sales.reps.created') };
  });
}

export async function savePlanAction(planId, formData) {
  const t = await getT();
  return guarded(t, async (session) => {
    const existing = planId ? positiveInt(planId) : null;
    const checked = validatePlanInput({
      name: formData.get('name'),
      kind: formData.get('kind'),
      currency: formData.get('currency'),
      onboardingBonus: formData.get('onboarding_bonus'),
      subscriptionRate: formData.get('subscription_rate'),
      monthlyTarget: formData.get('monthly_target'),
      targetBonus: formData.get('target_bonus'),
      active: formData.get('active'),
    });
    if (checked.errorKey) return { ok: false, error: t(checked.errorKey) };
    const result = await saveSalesPlan(existing, checked.values);
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: existing ? 'sales.plan_update' : 'sales.plan_create', entityType: 'sales_plan', entityId: result.id, details: checked.values,
    });
    revalidatePath('/admin/sales/plans');
    refresh();
    return { ok: true, message: t(existing ? 'admin.sales.plans.updated' : 'admin.sales.plans.created') };
  });
}

/** `creditFromDay` "YYYY-MM-DD", Kinshasa; empty = from now. Never in the future. */
export async function assignAgentsAction(repId, agentIds, creditFromDay) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    if (!rep) return { ok: false, error: t('admin.sales.reps.notFound') };
    let creditFrom = new Date().toISOString();
    if (creditFromDay) {
      if (String(creditFromDay) > todayInKinshasa()) return { ok: false, error: t('admin.sales.accounts.creditFuture') };
      creditFrom = kinshasaDayStart(creditFromDay);
      if (!creditFrom) return { ok: false, error: t('admin.sales.accounts.creditInvalid') };
    }
    const result = await assignAgentsToRep({ repId: rep, agentIds, creditFrom, adminId: adminIdOf(session) });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'sales.assign', entityType: 'sales_rep', entityId: rep,
      details: { agentIds: result.assignedIds, movedFromOtherRep: result.movedIds, creditFrom },
    });
    for (const agentId of result.assignedIds) revalidatePath(`/admin/agents/${agentId}`);
    refresh(rep);
    return {
      ok: true,
      message: result.assignedIds.length
        ? t('admin.sales.accounts.assigned', { count: result.assignedIds.length })
        : t('admin.sales.accounts.alreadyAssigned'),
    };
  });
}

export async function endAssignmentAction(repId, agentId) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    const agent = positiveInt(agentId);
    if (!rep || !agent) return { ok: false, error: t('admin.sales.accounts.notAssigned') };
    const ended = await endRepAssignment({ repId: rep, agentId: agent, adminId: adminIdOf(session) });
    if (!ended) return { ok: false, error: t('admin.sales.accounts.notAssigned') };
    await recordAudit(session, { action: 'sales.unassign', entityType: 'sales_rep', entityId: rep, details: { agentId: agent } });
    revalidatePath(`/admin/agents/${agent}`);
    refresh(rep);
    return { ok: true, message: t('admin.sales.accounts.unassigned') };
  });
}

export async function approveCommissionsAction(repId, ids) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    if (!rep) return { ok: false, error: t('admin.sales.reps.notFound') };
    const { approvedIds } = await approveCommissions({ repId: rep, ids, adminId: adminIdOf(session) });
    if (approvedIds.length === 0) return { ok: false, error: t('admin.sales.ledger.nothingToApprove') };
    await recordAudit(session, { action: 'sales.approve', entityType: 'sales_rep', entityId: rep, details: { commissionIds: approvedIds } });
    refresh(rep);
    return { ok: true, message: t('admin.sales.ledger.approved', { count: approvedIds.length }) };
  });
}

export async function voidCommissionAction(repId, commissionId, reason) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    const id = positiveInt(commissionId);
    const text = String(reason || '').trim().replace(/\s+/g, ' ');
    if (text.length < 3 || text.length > 500) return { ok: false, error: t('admin.sales.ledger.reasonInvalid') };
    const voided = rep && id ? await voidCommission({ repId: rep, id, reason: text }) : null;
    if (!voided) return { ok: false, error: t('admin.sales.ledger.notVoidable') };
    await recordAudit(session, {
      action: 'sales.void', entityType: 'sales_rep', entityId: rep, details: { commissionId: id, reason: text, amount: voided.amount, currency: voided.currency },
    });
    refresh(rep);
    return { ok: true, message: t('admin.sales.ledger.voided') };
  });
}

export async function addAdjustmentAction(repId, formData) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    const amount = parseAmount(formData.get('amount'), { allowNegative: true, allowZero: false });
    const currency = normaliseCurrency(formData.get('currency'));
    const note = String(formData.get('note') || '').trim().replace(/\s+/g, ' ');
    if (!rep) return { ok: false, error: t('admin.sales.reps.notFound') };
    if (amount == null) return { ok: false, error: t('admin.sales.ledger.amountInvalid') };
    if (!currency) return { ok: false, error: t('admin.sales.plans.currencyInvalid') };
    if (note.length < 3 || note.length > 500) return { ok: false, error: t('admin.sales.ledger.reasonInvalid') };
    const result = await addCommissionAdjustment({ repId: rep, amount, currency, note, adminId: adminIdOf(session) });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'sales.adjustment', entityType: 'sales_rep', entityId: rep, details: { commissionId: result.id, amount, currency, note },
    });
    refresh(rep);
    return { ok: true, message: t('admin.sales.ledger.adjustmentAdded') };
  });
}

/** `ids` empty/null = every approved line in the chosen currency. */
export async function recordPayoutAction(repId, ids, formData) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    const currency = normaliseCurrency(formData.get('currency'));
    const method = String(formData.get('method') || '').trim();
    const reference = String(formData.get('reference') || '').trim();
    const note = String(formData.get('note') || '').trim();
    const paidAt = String(formData.get('paid_at') || '');
    if (!rep) return { ok: false, error: t('admin.sales.reps.notFound') };
    if (!currency) return { ok: false, error: t('admin.sales.plans.currencyInvalid') };
    if (!method || method.length > 60) return { ok: false, error: t('admin.sales.ledger.methodInvalid') };
    if (reference.length > 120 || note.length > 500) return { ok: false, error: t('admin.sales.ledger.referenceInvalid') };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt) || paidAt > todayInKinshasa()) return { ok: false, error: t('admin.sales.ledger.paidAtInvalid') };
    const result = await recordSalesPayout({
      repId: rep,
      currency,
      ids: Array.isArray(ids) && ids.length ? ids : null,
      method,
      reference: reference || null,
      note: note || null,
      paidAt,
      adminId: adminIdOf(session),
    });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'sales.payout', entityType: 'sales_rep', entityId: rep,
      details: { payoutId: result.payoutId, total: result.total, currency, lines: result.count, method, reference: reference || null, paidAt },
    });
    refresh(rep);
    return { ok: true, message: t('admin.sales.ledger.paid', { count: result.count }) };
  });
}

// ---------------------------------------------------------------------------
// Launch commission policy: agent validation, listing exclusions, attribution
// ---------------------------------------------------------------------------

function cleanText(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max + 1);
}

/** Recount after a change that moves a rep's tiers; a failure is reported, never hidden. */
async function rerun(session) {
  const counts = await syncSalesCommissions();
  await recordAudit(session, { action: 'sales.sync', details: { ...counts, trigger: 'change' } });
  return counts;
}

/** `status` validated | rejected | pending. Rejection needs a reason. */
export async function setAgentValidationAction(repId, agentId, status, reason) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    const agent = positiveInt(agentId);
    const text = cleanText(reason, 500);
    if (!rep || !agent || !['validated', 'rejected', 'pending'].includes(status)) return { ok: false, error: t('admin.sales.launch.agentMissing') };
    if (status === 'rejected' && (text.length < 3 || text.length > 500)) return { ok: false, error: t('admin.sales.ledger.reasonInvalid') };
    const updated = await setAttributionValidation({ repId: rep, agentId: agent, status, reason: text || null, adminId: adminIdOf(session) });
    if (!updated) return { ok: false, error: t('admin.sales.launch.agentMissing') };
    await recordAudit(session, {
      action: `sales.agent_${status === 'pending' ? 'reopened' : status}`, entityType: 'agent', entityId: agent,
      details: { repId: rep, reason: status === 'rejected' ? text : undefined },
    });
    await rerun(session);
    refresh(rep);
    revalidatePath(`/admin/agents/${agent}`);
    return { ok: true, message: t(`admin.sales.launch.validation.done.${status}`) };
  });
}

export async function excludeCreditAction(repId, creditId, reason) {
  const t = await getT();
  return guarded(t, async (session) => {
    const rep = positiveInt(repId);
    const credit = positiveInt(creditId);
    const text = cleanText(reason, 500);
    if (text.length < 3 || text.length > 500) return { ok: false, error: t('admin.sales.ledger.reasonInvalid') };
    const excluded = rep && credit ? await excludeListingCredit({ repId: rep, creditId: credit, reason: text, adminId: adminIdOf(session) }) : null;
    if (!excluded) return { ok: false, error: t('admin.sales.launch.credits.notExcludable') };
    await recordAudit(session, {
      action: 'sales.listing_excluded', entityType: 'listing', entityId: excluded.property_id,
      details: { repId: rep, agentId: excluded.agent_id, creditId: credit, reason: text },
    });
    await rerun(session);
    refresh(rep);
    return { ok: true, message: t('admin.sales.launch.credits.excluded') };
  });
}

/**
 * Attribute an agent to a rep by hand — a correction with evidence, or an
 * agent referred offline. Reason 20–1000 characters; `creditFromDay` (Kinshasa
 * "YYYY-MM-DD", optional, never in the future) moves the date from which their
 * listings count.
 */
export async function overrideAttributionAction(agentId, toRepId, reason, evidence, creditFromDay) {
  const t = await getT();
  return guarded(t, async (session) => {
    const agent = positiveInt(agentId);
    const rep = positiveInt(toRepId);
    const text = cleanText(reason, 1000);
    const proof = cleanText(evidence, 1000);
    if (!agent || !rep) return { ok: false, error: t('admin.sales.attribution.chooseRep') };
    if (text.length < 20 || text.length > 1000) return { ok: false, error: t('admin.sales.attribution.reasonInvalid') };
    if (proof.length > 1000) return { ok: false, error: t('admin.sales.attribution.evidenceInvalid') };
    let creditFrom = null;
    if (creditFromDay) {
      if (String(creditFromDay) > todayInKinshasa()) return { ok: false, error: t('admin.sales.accounts.creditFuture') };
      creditFrom = kinshasaDayStart(creditFromDay) || null;
      if (!creditFrom) return { ok: false, error: t('admin.sales.accounts.creditInvalid') };
    }
    const result = await overrideAttribution({
      agentId: agent, toRepId: rep, reason: text, evidence: proof || null, creditFrom, adminId: adminIdOf(session),
    });
    if (result.errorKey) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'sales.attribution_override', entityType: 'agent', entityId: agent,
      details: { fromRepId: result.fromRepId, toRepId: result.toRepId, reason: text, evidence: proof || null, creditFrom },
    });
    await rerun(session);
    refresh(rep);
    if (result.fromRepId) revalidatePath(`/admin/sales/${result.fromRepId}`);
    revalidatePath(`/admin/agents/${agent}`);
    revalidatePath('/admin/sales/attribution');
    return { ok: true, message: t('admin.sales.attribution.saved') };
  });
}
