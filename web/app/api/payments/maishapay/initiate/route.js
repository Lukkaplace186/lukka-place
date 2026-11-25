import { NextResponse } from 'next/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getDemoPairForAgent } from '@/lib/demoAccounts';
import { startMobileMoneyPayment } from '@/lib/payments';
import { getFeatureFlags } from '@/lib/siteSettings';

/**
 * POST /api/payments/maishapay/initiate  {packageId, phone, operator}
 *
 * A signed-in agent starts paying for a plan by mobile money: an invoice is
 * created and MaishaPay pushes the payment prompt to `phone` on `operator`
 * (mpesa | orange | airtel). Answers {invoiceId, reference}; the page then
 * polls /status. lib/payments.js has the flow. Same-origin only — the agent
 * session cookie must not be usable from another site's form. Closed, like
 * the page, while the Abonnements switch is off.
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

const STATUS_FOR = { not_configured: 503, provider: 502, agent: 403 };

export async function POST(request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'origin' }, { status: 403 });
  const agentId = await getCurrentAgentId();
  if (!agentId) return NextResponse.json({ error: 'auth' }, { status: 401 });
  // A demo agent never starts a real mobile-money payment (lib/demoAccounts.js).
  if (await getDemoPairForAgent(agentId)) return NextResponse.json({ error: 'demo' }, { status: 403 });
  if (!(await getFeatureFlags()).agentSubscriptions) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body' }, { status: 400 });
  }
  const packageId = Number.parseInt(body?.packageId, 10);
  if (!Number.isSafeInteger(packageId) || packageId <= 0) return NextResponse.json({ error: 'package' }, { status: 400 });

  try {
    const result = await startMobileMoneyPayment({ agentId, packageId, phone: body?.phone, operator: body?.operator });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR[result.error] || 400 });
    return NextResponse.json({ invoiceId: result.invoiceId, reference: result.reference });
  } catch (err) {
    console.error(`[payments] initiate failed for agent #${agentId}: ${err.message}`);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
