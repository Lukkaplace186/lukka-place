import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { recordAudit } from '@/lib/adminAudit';
import { syncSalesCommissions } from '@/lib/sales';

export const dynamic = 'force-dynamic';

/**
 * The daily commission run, called by the engine's scheduler (job
 * `sales-commissions`, services/scheduler.js) with Bearer CRON_SECRET. The same
 * idempotent run as the "Calculer les commissions" button: a second call
 * creates nothing new. Audited as `sales.sync` so /admin/sales shows when it
 * last ran and who ran it.
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
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const counts = await syncSalesCommissions();
    await recordAudit(SCHEDULER_ACTOR, { action: 'sales.sync', details: { ...counts, trigger: 'scheduler' } });
    return NextResponse.json({ ok: true, ...counts });
  } catch (err) {
    console.error(`[sales-commissions] run failed: ${err.message}`);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
