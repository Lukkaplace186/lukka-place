'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import {
  adminUpdateAgent,
  revokeAgentSessions,
  issueAgentActivationLink,
  reassignAgentListings,
  getAgentById,
} from '@/lib/agents';

async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

function revalidateAgent(agentId) {
  revalidatePath('/admin/agents');
  revalidatePath(`/admin/agents/${agentId}`);
  revalidatePath(`/agents/${agentId}`);
}

/**
 * Identity, territory and verification, in one save.
 *
 * Both commune lists are filtered against `validCommunes`, bound at render
 * time from the engine's own canonical hierarchy — never free text. A commune
 * name that doesn't exist would break three things at once and silently: the
 * public "communes desservies" section, the listings filter, and the lead
 * matcher's coverage WHERE clause, which is the mechanism deciding who gets
 * paid work.
 *
 * `serviced` is unioned with `primary` rather than stored independently. A
 * commune an agency calls a specialty that isn't in their coverage set is a
 * contradiction the ranking query would resolve arbitrarily; making it
 * impossible to express beats validating against it.
 */
export async function adminSaveAgentAction(agentId, validCommunes, formData) {
  try {
    await assertAdminSession();
    const valid = new Set(validCommunes);

    const primary = formData.getAll('primary_communes').map(String).filter((c) => valid.has(c));
    const serviced = formData.getAll('serviced_communes').map(String).filter((c) => valid.has(c));
    const status = Number.parseInt(formData.get('status'), 10);

    const ok = await adminUpdateAgent(agentId, {
      agencyName: String(formData.get('agency_name') || '').trim().slice(0, 160) || null,
      email: String(formData.get('email') || '').trim().slice(0, 190) || null,
      status: [0, 1].includes(status) ? status : undefined,
      primaryCommunes: primary,
      servicedCommunes: [...new Set([...serviced, ...primary])],
      phoneVerified: formData.get('phone_verified') === 'on',
    });

    if (!ok) return { ok: false, error: 'Agent introuvable.' };
    revalidateAgent(agentId);
    return { ok: true };
  } catch (err) {
    console.error(`[admin/agents] save #${agentId} failed: ${err.message}`);
    return { ok: false, error: err.message || 'La mise à jour a échoué.' };
  }
}

/**
 * Sends a fresh WhatsApp magic link and invalidates every existing session
 * in the same statement — see lib/agents.js's issueAgentActivationLink for
 * why this is a link rather than an admin-chosen temporary password.
 */
export async function adminResetAgentAccessAction(agentId) {
  try {
    await assertAdminSession();
    const result = await issueAgentActivationLink(agentId);
    revalidateAgent(agentId);
    return result;
  } catch (err) {
    return { ok: false, error: err.message || "L'envoi a échoué." };
  }
}

/** Sign the agent out everywhere, without touching their password. */
export async function adminRevokeAgentSessionsAction(agentId) {
  try {
    await assertAdminSession();
    const ok = await revokeAgentSessions(agentId);
    revalidateAgent(agentId);
    return ok ? { ok: true } : { ok: false, error: 'Agent introuvable.' };
  } catch (err) {
    return { ok: false, error: err.message || "L'action a échoué." };
  }
}

/**
 * Moves an agency's whole portfolio to another agent.
 *
 * The target is verified to be a real agents row before anything moves —
 * `properties.agent_id` has a FK, but a typo'd id that happens to exist would
 * hand an entire portfolio to the wrong agency, and that is not something to
 * discover afterwards.
 */
export async function adminReassignListingsAction(fromAgentId, formData) {
  try {
    await assertAdminSession();
    const toAgentId = Number.parseInt(formData.get('to_agent_id'), 10);
    if (!Number.isFinite(toAgentId)) return { ok: false, error: 'Choisissez un agent de destination.' };
    if (toAgentId === Number(fromAgentId)) return { ok: false, error: 'Choisissez un agent différent.' };

    const target = await getAgentById(toAgentId);
    if (!target) return { ok: false, error: `Aucun agent #${toAgentId}.` };

    const moved = await reassignAgentListings(fromAgentId, toAgentId);
    revalidateAgent(fromAgentId);
    revalidatePath('/admin/listings');
    revalidatePath('/listings');
    return { ok: true, moved };
  } catch (err) {
    return { ok: false, error: err.message || 'Le transfert a échoué.' };
  }
}
