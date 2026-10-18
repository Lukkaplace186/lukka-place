import { NextResponse } from 'next/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { startFlexpaiePayment } from '@/lib/payments';

/**
 * POST /api/payments/flexpaie/initiate  {packageId, phone}
 *
 * A signed-in agent starts paying for a plan by mobile money: an invoice is
 * created and FlexPaie pushes the payment prompt to `phone`. Answers
 * {invoiceId, reference}; the page then polls /status. lib/payments.js has
 * the flow. Same-origin only — the agent session cookie must not be usable
 * from another site's form.
 */
export const dynamic = 'force-dynamic';

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'origin' }, { status: 403 });
  const agentId = await getCurrentAgentId();
  if (!agentId) return NextResponse.json({ error: 'auth' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body' }, { status: 400 });
  }
  const packageId = Number.parseInt(body?.packageId, 10);
  if (!Number.isSafeInteger(packageId) || packageId <= 0) return NextResponse.json({ error: 'package' }, { status: 400 });

  try {
    const result = await startFlexpaiePayment({ agentId, packageId, phone: body?.phone });
    if (!result.ok) {
      const status = result.error === 'not_configured' ? 503 : result.error === 'provider' ? 502 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ invoiceId: result.invoiceId, reference: result.reference });
  } catch (err) {
    console.error(`[payments] initiate failed for agent #${agentId}: ${err.message}`);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
