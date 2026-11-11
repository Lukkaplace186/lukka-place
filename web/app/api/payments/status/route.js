import { NextResponse } from 'next/server';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getInvoiceForAgent, settleInvoice } from '@/lib/payments';

/**
 * GET /api/payments/status?invoice=<id> — the checkout and return pages poll
 * this while a payment is open. Provider-neutral: a pending invoice is
 * re-checked with its own provider on each poll (lib/payments.js
 * settleInvoice), so a lost callback never leaves a paid plan unapplied.
 * Only the agent's own agency's invoices answer.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const invoiceId = Number.parseInt(new URL(request.url).searchParams.get('invoice') || '', 10);
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return NextResponse.json({ error: 'invoice' }, { status: 400 });

  let invoice = await getInvoiceForAgent(agentId, invoiceId);
  if (!invoice) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (invoice.status === 'pending') {
    await settleInvoice(invoiceId).catch((err) => console.error(`[payments] status re-check of #${invoiceId} failed: ${err.message}`));
    invoice = await getInvoiceForAgent(agentId, invoiceId);
  }
  return NextResponse.json(
    { status: invoice.status, reference: invoice.reference, paidAt: invoice.paid_at },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
