'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import {
  adminUpdateAgent,
  revokeAgentSessions,
  issueAgentActivationLink,
  reassignAgentListings,
  getAgentById,
} from '@/lib/agents';
import { adminSetAccountPassword } from '@/lib/adminPasswordReset';
import { getT } from '@/lib/i18n/server';

function revalidateAgent(agentId) {
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${agentId}`);
  revalidatePath(`/agents/${agentId}`);
}

/**
 * Identity, territory and verification, in one save.
 *
 * Both commune lists are filtered against `validCommunes`, bound at render
 * time from the engine's own canonical hierarchy — never free text. `serviced`
 * is unioned with `primary`: a specialty outside coverage is a contradiction
 * the ranking query would resolve arbitrarily.
 */
export async function adminSaveAgentAction(agentId, validCommunes, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const valid = new Set(validCommunes);

    const primary = formData.getAll('primary_communes').map(String).filter((c) => valid.has(c));
    const serviced = formData.getAll('serviced_communes').map(String).filter((c) => valid.has(c));
    const status = Number.parseInt(formData.get('status'), 10);
    const phoneVerified = formData.get('phone_verified') === 'on';

    const ok = await adminUpdateAgent(agentId, {
      agencyName: String(formData.get('agency_name') || '').trim().slice(0, 160) || null,
      email: String(formData.get('email') || '').trim().slice(0, 190) || null,
      status: [0, 1].includes(status) ? status : undefined,
      primaryCommunes: primary,
      servicedCommunes: [...new Set([...serviced, ...primary])],
      phoneVerified,
    });

    if (!ok) return { ok: false, error: t('errors.agentNotFound') };
    await recordAudit(session, {
      action: 'agent.update',
      entityType: 'agent',
      entityId: agentId,
      details: { status: [0, 1].includes(status) ? status : null, phoneVerified, primary, serviced },
    });
    revalidateAgent(agentId);
    return { ok: true };
  } catch (err) {
    console.error(`[admin/agents] save #${agentId} failed: ${err.message}`);
    return { ok: false, error: err.message || 'La mise à jour a échoué.' };
  }
}

/** Sends a fresh WhatsApp magic link and invalidates every existing session in the same statement. */
export async function adminResetAgentAccessAction(agentId) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.security');
    const { errorKey, ...result } = await issueAgentActivationLink(agentId);
    if (!errorKey) await recordAudit(session, { action: 'agent.access_reset', entityType: 'agent', entityId: agentId });
    revalidateAgent(agentId);
    return errorKey ? { ...result, error: t(errorKey) } : result;
  } catch (err) {
    return { ok: false, error: err.message || t('errors.sendFailedShort') };
  }
}

/**
 * Sets the agent's password to one the admin typed. The password itself is
 * never returned, logged, or written to the audit log.
 */
export async function adminSetAgentPasswordAction(agentId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.security');
    const { errorKey, ...result } = await adminSetAccountPassword({
      role: 'agent',
      id: agentId,
      password: formData.get('password'),
      confirm: formData.get('password_confirm'),
    });
    if (errorKey) return { ...result, error: t(errorKey) };
    await recordAudit(session, { action: 'agent.password_set', entityType: 'agent', entityId: agentId });
    revalidateAgent(agentId);
    return result;
  } catch (err) {
    console.error(`[admin/agents] password reset #${agentId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** Sign the agent out everywhere, without touching their password. */
export async function adminRevokeAgentSessionsAction(agentId) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.security');
    const ok = await revokeAgentSessions(agentId);
    if (ok) await recordAudit(session, { action: 'agent.sessions_revoked', entityType: 'agent', entityId: agentId });
    revalidateAgent(agentId);
    return ok ? { ok: true } : { ok: false, error: t('errors.agentNotFound') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** Moves an agency's whole portfolio to another agent — the target is verified real first. */
export async function adminReassignListingsAction(fromAgentId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('agents.manage');
    const toAgentId = Number.parseInt(formData.get('to_agent_id'), 10);
    if (!Number.isFinite(toAgentId)) return { ok: false, error: t('errors.chooseDestinationAgent') };
    if (toAgentId === Number(fromAgentId)) return { ok: false, error: t('errors.chooseDifferentAgent') };

    const target = await getAgentById(toAgentId);
    if (!target) return { ok: false, error: `Aucun agent #${toAgentId}.` };

    const moved = await reassignAgentListings(fromAgentId, toAgentId);
    await recordAudit(session, {
      action: 'agent.listings_transferred',
      entityType: 'agent',
      entityId: fromAgentId,
      details: { toAgentId, moved },
    });
    revalidateAgent(fromAgentId);
    revalidatePath('/admin/listings');
    revalidatePath('/listings');
    return { ok: true, moved };
  } catch (err) {
    return { ok: false, error: err.message || 'Le transfert a échoué.' };
  }
}
