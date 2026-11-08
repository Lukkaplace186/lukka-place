import 'server-only';
import { notifyAgentOfContactTap } from '@/lib/adminApi';

/**
 * "Un client vous contacte" — web's half (engine services/contactTapAlert.js).
 *
 * A tap on a verified agent's WhatsApp or "Appeler" button opens a chat or a
 * call between two personal numbers that never reaches us. The tap is the one
 * moment we know, so the two tap endpoints (/api/telemetry/lead-click and
 * /api/track's call_click) ask the engine to tell the agent straight away.
 *
 * Only a real visitor's tap on a DIRECT button alerts: never the listing's
 * own agent, the team, a bot or a prefetch (lib/trackIngest.js viewer_kind),
 * and never a tap that went to Lukka Place's central number (that one reaches
 * our WhatsApp, which already handles it). The engine dedupes and applies the
 * agent gates again.
 *
 * @returns {'whatsapp'|'call'|null} the kind of alert to send, or none.
 */
export function contactTapKind({ event, routingType, viewerKind, recorded }) {
  if (viewerKind !== 'visitor' || recorded === false) return null;
  if (event === 'whatsapp_cta_clicked' && routingType === 'DIRECT_WA') return 'whatsapp';
  if (event === 'call_click' && routingType === 'DIRECT') return 'call';
  return null;
}

/** Fire-and-forget body for `after()`: never throws into the response. */
export async function alertAgentOfContactTap({ listingId, kind, visitorId = null }) {
  try {
    const result = await notifyAgentOfContactTap({ listingId, kind, visitorKey: visitorId });
    if (!result?.sent) console.log(`[contact-tap] listing #${listingId} ${kind}: no alert (${result?.reason || 'unknown'})`);
  } catch (err) {
    console.error(`[contact-tap] listing #${listingId} ${kind}: engine call failed: ${err.message}`);
  }
}
