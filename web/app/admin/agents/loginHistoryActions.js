'use server';

import { requireAdmin } from '@/lib/adminSession';
import { getLoginHistory } from '@/lib/agentLoginLog';
import { deviceLabel } from '@/lib/agentLoginRules';
import { formatKinshasaTime } from './agentRows';

/**
 * "Historique de connexion" on /admin/agents: the agent's last 100 sign-in
 * attempts, Kinshasa time, with IP and a short device label. agents.manage
 * only — it shows IP addresses, which a sales account has no use for.
 */
export async function getAgentLoginHistoryAction(agentId) {
  try {
    await requireAdmin('agents.manage');
    const id = Number(agentId);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'invalid' };
    const { available, rows } = await getLoginHistory(id);
    return {
      ok: true,
      available,
      rows: rows.map((row) => ({
        id: Number(row.id),
        outcome: row.outcome,
        at: formatKinshasaTime(row.attempted_at),
        ip: row.ip_address || null,
        device: deviceLabel(row.user_agent),
      })),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
