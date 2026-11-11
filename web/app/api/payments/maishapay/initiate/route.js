import { NextResponse } from 'next/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getFeatureFlags } from '@/lib/siteSettings';
import { startMaishapayPayment } from '@/lib/maishapayPayments';

/**
 * POST /api/payments/maishapay/initiate
 *   {packageId, channel: 'mobile_money'|'card', provider, phone?, autoRenew, acceptedTerms}
 *
 * A signed-in agent starts paying for a plan from /compte/agent/abonnement/payer.
 * Answers {invoiceId, reference, paymentUrl}: mobile money → paymentUrl null and
 * the page polls /api/payments/status while the PIN prompt is on the phone;
 * card → the page sends the browser to paymentUrl (MaishaPay's card page).
 * Same-origin only — the agent session cookie must not be usable from another
 * site's form. lib/maishapayPayments.js has the flow.
 */
export const dynamic = 'force-dynamic';

const STATUS_FOR_ERROR = { not_configured: 503, provider: 502, pending_exists: 409 };

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
  if (!(await getFeatureFlags()).agentSubscriptions) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
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
    const result = await startMaishapayPayment({
      agentId,
      packageId,
      channel: String(body?.channel || ''),
      provider: String(body?.provider || '').toUpperCase(),
      phone: body?.phone,
      autoRenew: body?.autoRenew === true,
      acceptedTerms: body?.acceptedTerms === true,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS_FOR_ERROR[result.error] || 400 });
    return NextResponse.json({ invoiceId: result.invoiceId, reference: result.reference, paymentUrl: result.paymentUrl });
  } catch (err) {
    console.error(`[payments] MaishaPay initiate failed for agent #${agentId}: ${err.message}`);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
