import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { announceOnWrite } from '@/lib/referralAnnouncement';

export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/referral-announce — the engine's call when a VERIFIED
 * agent writes to the intake number (services/referralAnnounce.js). Bearer
 * CRON_SECRET, like /api/internal/agent-command. Body:
 * { agentId, previousInboundAt? } — the agent's message before this one (ISO),
 * which decides whether an earlier session announcement could have landed.
 * Answers { status }: sent | refused | already | not-eligible | unavailable.
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

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const agentId = Number.parseInt(body?.agentId, 10);
  if (!Number.isSafeInteger(agentId) || agentId <= 0) return NextResponse.json({ error: 'invalid agent' }, { status: 400 });
  const previous = typeof body?.previousInboundAt === 'string' && Number.isFinite(Date.parse(body.previousInboundAt))
    ? body.previousInboundAt
    : null;
  try {
    return NextResponse.json(await announceOnWrite({ agentId, previousInboundAt: previous }));
  } catch (err) {
    console.error(`[referral-announce] agent #${agentId}: ${err.message}`);
    return NextResponse.json({ status: 'failed' }, { status: 500 });
  }
}
