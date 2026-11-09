import { getCurrentAgentId } from '@/lib/agentSession';
import { recordAgentContactAttempt } from '@/lib/adminApi';
import { findOwnedLead } from '@/lib/agentLeadOwnership';
import { findOwnedViewingRequest } from '@/lib/agentViewingOwnership';
import { clientKey, rateLimited } from '@/lib/eventIngest';

/**
 * POST /api/agent/contact-attempt — an agent tapped WhatsApp or "Appeler" on a
 * customer from their dashboard (lead card, quick replies, alternatives, visit
 * card, agenda, "À faire"), or declared "J'ai déjà contacté le client".
 *
 * WHY (2026-11-09 gap analysis, owner decision "record taps only")
 * Those buttons open the agent's own WhatsApp, so the reply itself is
 * invisible to us; the tap is the one moment we know. Recorded in the engine
 * (agent_contact_attempts): a NEW lead moves to CONTACTED; a visit is only
 * annotated. Sent with fetch keepalive from the browser so it survives the
 * page handing over to WhatsApp.
 *
 * The agent comes from their own session cookie, never the body, and the lead
 * or visit must be theirs (the Demandes inbox's ownership rules). Anything
 * else is a 404, so ids cannot be probed. Impersonation is read-only at the
 * edge (middleware), so a "view as" never records a tap.
 */
const CHANNELS = ['whatsapp', 'phone'];
const SOURCES = ['lead_card', 'quick_reply', 'alternatives', 'visit_card', 'agenda', 'today', 'declared'];

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request) {
  if (rateLimited(clientKey(request))) {
    return Response.json({ success: false, error: 'Too many events' }, { status: 429 });
  }
  const agentId = await getCurrentAgentId();
  if (!agentId) return Response.json({ success: false, error: 'Not signed in' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  const leadId = positiveInt(body?.leadId);
  const viewingRequestId = positiveInt(body?.viewingRequestId);
  const { channel, source } = body || {};
  if ((leadId == null) === (viewingRequestId == null)) {
    return Response.json({ success: false, error: 'Give exactly one of leadId or viewingRequestId' }, { status: 400 });
  }
  if (!CHANNELS.includes(channel) || !SOURCES.includes(source)) {
    return Response.json({ success: false, error: 'Invalid channel or source' }, { status: 400 });
  }

  try {
    const owned = leadId != null
      ? await findOwnedLead(agentId, leadId)
      : await findOwnedViewingRequest(agentId, viewingRequestId);
    if (!owned) return Response.json({ success: false, error: 'Not found' }, { status: 404 });
    const result = await recordAgentContactAttempt({ agentId, leadId, viewingRequestId, channel, source });
    return Response.json({ success: true, recorded: Boolean(result.recorded), leadMoved: Boolean(result.leadMoved) });
  } catch (err) {
    console.error(`[contact-attempt] agent #${agentId}: ${err.message}`);
    return Response.json({ success: false, error: 'Could not record' }, { status: 502 });
  }
}
