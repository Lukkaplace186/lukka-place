import 'server-only';
import { recordAudit, actorLabel } from './adminAudit';
import { addNote } from './adminNotes';
import { adminVerificationNote } from './adminAgentCreate';

/**
 * Who vouched for a number verified without a code: the audit log and a note
 * on the agent's timeline. One helper for the three console paths —
 * "Créer un agent", "Vérifier le numéro" and the profile's "Numéro vérifié"
 * checkbox (app/admin/agents/createAgentActions.js, [id]/actions.js). Lives
 * here, not in a 'use server' file, where every export becomes a callable
 * server action.
 */
export async function recordAgentVouch(session, agentId, { created, details }) {
  await recordAudit(session, {
    action: created ? 'agent.admin_create' : 'agent.admin_verify',
    entityType: 'agent',
    entityId: agentId,
    details,
  });
  try {
    await addNote(session, 'agent', agentId, adminVerificationNote({ created, actor: actorLabel(session) }));
  } catch (err) {
    console.error(`[admin/agents] note for #${agentId} failed: ${err.message}`);
  }
}
