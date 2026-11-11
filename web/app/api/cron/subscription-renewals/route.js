import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { runRenewalSweep } from '@/lib/subscriptionRenewals';

/**
 * The daily automatic-renewal run, called by the engine's scheduler (job
 * `subscription-renewals`, services/scheduler.js) with Bearer CRON_SECRET.
 * Idempotent per subscription (lib/subscriptionRenewals.js claims each one
 * before prompting), so a retry never sends a second PIN prompt.
 */
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const counts = await runRenewalSweep();
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    console.error(`[renewals] run failed: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
