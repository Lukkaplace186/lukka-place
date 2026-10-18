import { NextResponse } from 'next/server';
import { callbackTokenValid, recordCallback, settleInvoice } from '@/lib/payments';

/**
 * FlexPaie's callback: /api/payments/flexpaie/webhook?invoice=<id>&token=<t>
 *
 * The URL was built for one invoice with a one-off token (only its SHA-256 is
 * stored); a request without the right pair is a 404, whatever its body says.
 * With it, the body is logged and then IGNORED as evidence: the invoice is
 * settled from FlexPaie's own status check (lib/payments.js settleInvoice),
 * so a forged or replayed callback can at most trigger a harmless re-check.
 */
export const dynamic = 'force-dynamic';

async function handle(request) {
  const url = new URL(request.url);
  const invoiceId = Number.parseInt(url.searchParams.get('invoice') || '', 10);
  const token = url.searchParams.get('token') || '';
  if (!(await callbackTokenValid(invoiceId, token).catch(() => false))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let payload = null;
  if (request.method === 'POST') {
    const text = await request.text().catch(() => '');
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }
  } else {
    payload = Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'token'));
  }
  await recordCallback(invoiceId, payload);

  try {
    const state = await settleInvoice(invoiceId);
    return NextResponse.json({ received: true, state });
  } catch (err) {
    console.error(`[payments] settling invoice #${invoiceId} after callback failed: ${err.message}`);
    // 500 so FlexPaie retries, if it does; the agent's status poll also re-checks.
    return NextResponse.json({ received: true, state: 'error' }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
