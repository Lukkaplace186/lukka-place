import { SHARED_IP_MAX_EVENTS, clientKey, rateLimited } from '@/lib/eventIngest';
import { sanitizeWaSheetEvent, userAgentKind } from '@/lib/waSheetRules';

/**
 * POST /api/telemetry/wa-sheet — one log line per WhatsApp sheet step
 * (lib/waSheetRules.js has why). Public, write-only, validated; nothing
 * free-text is logged and nothing is stored.
 */
export async function POST(request) {
  if (rateLimited(`wa-sheet:${clientKey(request)}`, SHARED_IP_MAX_EVENTS)) {
    return new Response(null, { status: 429 });
  }
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const clean = sanitizeWaSheetEvent(body);
  if (clean) console.log(`[wa-sheet] ${JSON.stringify({ ...clean, ua: userAgentKind(request.headers.get('user-agent')) })}`);
  return new Response(null, { status: 204 });
}
