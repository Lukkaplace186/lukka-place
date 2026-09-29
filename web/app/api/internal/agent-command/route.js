import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { runAgentCommand } from '@/lib/agentCommands';

export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/agent-command — the engine's WhatsApp commands
 * (services/agentCommands.js). Bearer CRON_SECRET, like the cron routes: only
 * the engine calls it, after it has matched the sender to a VERIFIED agent.
 * Body: { agentId, command: 'mesbiens'|'share'|'aide', listingId? }.
 * Answers { ok, text } — the reply the engine sends back, in French.
 */

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const COMMANDS = new Set(['mesbiens', 'share', 'aide']);

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const agentId = Number.parseInt(body?.agentId, 10);
  if (!Number.isSafeInteger(agentId) || agentId <= 0 || !COMMANDS.has(body?.command)) {
    return NextResponse.json({ error: 'invalid command' }, { status: 400 });
  }
  try {
    return NextResponse.json(await runAgentCommand({ agentId, command: body.command, listingId: body.listingId }));
  } catch (err) {
    console.error(`[agent-command] ${body.command} for agent #${agentId}: ${err.message}`);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
