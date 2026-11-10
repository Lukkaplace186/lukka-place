import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { pushToAccount } from '@/lib/adminApi';
import { runEnquiredPriceDrops, runMonthlyMarket, runNewProjects, runWeeklySummary } from '@/lib/portalDigests';

/**
 * The scheduled portal alerts for customers with the Lukka Place app
 * (lib/portalDigests.js), one `task` per call, from the engine's scheduler
 * (services/portalAlerts.js):
 *   enquired-price-drops  daily; `pairs` = wa_id × listing the engine knows
 *   new-projects          daily
 *   weekly-summary        Sundays
 *   monthly-market        the 1st of the month
 * Secret-protected like /api/cron/search-alerts.
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

const TASKS = {
  'enquired-price-drops': (body) => runEnquiredPriceDrops({ pairs: Array.isArray(body.pairs) ? body.pairs : [], push: pushToAccount }),
  'new-projects': () => runNewProjects({ push: pushToAccount }),
  'weekly-summary': () => runWeeklySummary({ push: pushToAccount }),
  'monthly-market': () => runMonthlyMarket({ push: pushToAccount }),
};

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const run = TASKS[body?.task];
  if (!run) return NextResponse.json({ error: 'unknown task' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, task: body.task, ...(await run(body)) });
  } catch (err) {
    console.error(`[portal-alerts] ${body.task} failed: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
