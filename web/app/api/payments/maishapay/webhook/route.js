import { NextResponse } from 'next/server';
import { callbackTokenValid, recordCallback, settleInvoice } from '@/lib/payments';

/**
 * MaishaPay's callback: /api/payments/maishapay/webhook?invoice=<id>&token=<t>
 *
 * The URL was built for one invoice with a one-off token (only its SHA-256 is
 * stored); a request without the right pair is a 404, whatever it carries.
 * With it, what came in is logged and then IGNORED as evidence: the invoice is
 * settled from MaishaPay's own status check (lib/maishapayPayments.js), so a
 * forged or replayed callback can at most trigger a harmless re-check.
 *
 * Two kinds of caller use the same URL:
 *   - MaishaPay's server (mobile money), POSTing JSON → answered in JSON;
 *   - the agent's browser coming back from MaishaPay's card page (a GET, or a
 *     form POST, asking for HTML) → sent on to /compte/agent/abonnement/retour,
 *     which shows the result and keeps polling while it is still pending.
 */
export const dynamic = 'force-dynamic';

function wantsHtml(request) {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

async function readPayload(request, url) {
  const params = Object.fromEntries([...url.searchParams].filter(([key]) => key !== 'token'));
  if (request.method !== 'POST') return params;
  const text = await request.text().catch(() => '');
  if (!text) return params;
  try {
    return { ...params, body: JSON.parse(text) };
  } catch {
    return { ...params, body: Object.fromEntries(new URLSearchParams(text)) };
  }
}

async function handle(request) {
  const url = new URL(request.url);
  const invoiceId = Number.parseInt(url.searchParams.get('invoice') || '', 10);
  const token = url.searchParams.get('token') || '';
  if (!(await callbackTokenValid(invoiceId, token).catch(() => false))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await recordCallback(invoiceId, await readPayload(request, url));

  let state = 'error';
  try {
    state = await settleInvoice(invoiceId);
  } catch (err) {
    console.error(`[payments] settling MaishaPay invoice #${invoiceId} after callback failed: ${err.message}`);
  }

  if (wantsHtml(request)) {
    // 303 so a POSTed card-page return becomes a plain GET of our page.
    return NextResponse.redirect(new URL(`/compte/agent/abonnement/retour?facture=${invoiceId}`, url.origin), 303);
  }
  // 500 so MaishaPay retries, if it does; the agent's poll also re-checks.
  return NextResponse.json({ received: true, state }, { status: state === 'error' ? 500 : 200 });
}

export const POST = handle;
export const GET = handle;
