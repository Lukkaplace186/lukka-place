import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { recordAudit } from '@/lib/adminAudit';
import { syncReferralCredits } from '@/lib/referralCredits';
import { getDailySummary } from '@/lib/growthDashboard';

export const dynamic = 'force-dynamic';

/**
 * The morning run, called by the engine's scheduler (job `growth-daily`,
 * services/growthDaily.js) with Bearer CRON_SECRET:
 *  1. the agents' referral credits (lib/referralCredits.js, idempotent — the
 *     same run as the console's button);
 *  2. yesterday's summary text (lib/growthDashboard.js), which the ENGINE
 *     sends to the owners' phones — it holds the WhatsApp credentials.
 * A failed credit run does not stop the summary; both outcomes are returned.
 */

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
}

const SCHEDULER_ACTOR = { id: null, shared: false, name: 'Planificateur', email: 'engine' };

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let credits = null;
  let creditsError = null;
  try {
    credits = await syncReferralCredits();
    await recordAudit(SCHEDULER_ACTOR, { action: 'referrals.sync', details: { ...credits, trigger: 'scheduler' } });
  } catch (err) {
    creditsError = err.message;
    console.error(`[growth-daily] credit run failed: ${err.message}`);
  }

  try {
    const summary = await getDailySummary();
    return NextResponse.json({ ok: !creditsError, credits, creditsError, summary });
  } catch (err) {
    console.error(`[growth-daily] summary failed: ${err.message}`);
    return NextResponse.json({ ok: false, credits, creditsError, error: err.message }, { status: 500 });
  }
}
