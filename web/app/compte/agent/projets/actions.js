'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCurrentAgentId } from '@/lib/agentSession';
import { agentSetLotStatus, agentSetUnitsAvailable, getAgentProjects } from '@/lib/developments';
import { LOT_STATUSES } from '@/lib/developmentRules';

/**
 * The two facts a developer keeps current themselves: how many units of each
 * type are left, and each lot's status. Ownership is `d.agent_id = <session>`
 * inside each UPDATE (lib/developments.js), so a crafted id changes nothing.
 * Everything else about a project is edited by the Lukka Place team.
 */
async function revalidateOwn(agentId) {
  const projects = await getAgentProjects(agentId).catch(() => []);
  revalidatePath('/projets');
  for (const p of projects) revalidatePath(`/projets/${p.slug}`);
  revalidatePath('/compte/agent/projets');
}

export async function setUnitsAvailableAction(unitId, formData) {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const value = Number.parseInt(String(formData.get('units_available') ?? ''), 10);
  if (!Number.isFinite(value) || value < 0) redirect('/compte/agent/projets?error=units');
  const ok = await agentSetUnitsAvailable(agentId, unitId, value);
  if (!ok) redirect('/compte/agent/projets?error=units');
  await revalidateOwn(agentId);
  redirect('/compte/agent/projets?saved=1');
}

export async function setLotStatusAction(lotId, formData) {
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const status = String(formData.get('status') || '');
  if (!LOT_STATUSES.includes(status)) redirect('/compte/agent/projets?error=lot');
  const ok = await agentSetLotStatus(agentId, lotId, status);
  if (!ok) redirect('/compte/agent/projets?error=lot');
  await revalidateOwn(agentId);
  redirect('/compte/agent/projets?saved=1');
}
