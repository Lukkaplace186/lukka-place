import { NextResponse } from 'next/server';
import { getCurrentChatAgentId } from '@/lib/chat';

export const dynamic = 'force-dynamic';

/**
 * GET /app — where the Lukka Place app starts (mobile/capacitor.config.json
 * `server.url`). One app for everyone (owner decision 2026-11-10): an agent
 * still signed in lands in their agent space, everyone else on the listings
 * (a signed-in customer reaches the Espace Client from the header as on the
 * site). A relative Location: behind the proxy request.url names
 * localhost:3002 (see admin/impersonation/exit).
 */
export async function GET() {
  let target = '/';
  try {
    if (await getCurrentChatAgentId()) target = '/compte/agent';
  } catch (err) {
    // The database briefly unreachable: open the listings rather than fail the app's launch.
    console.error(`[app] start: agent session check failed: ${err.message}`);
  }
  return new NextResponse(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
}
