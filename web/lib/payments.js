import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPool } from './db';
import { assignPackageToAgent } from './subscriptions';
import { checkFlexpaieTransaction, initiateFlexpaiePayment, isFlexpaieConfigured } from './flexpaie';
import { invoiceReference, normaliseMobileMoneyPhone, readCheckResponse, redactForLog } from './flexpaieRules';

/**
 * Online plan payments through FlexPaie (migrations/20261018_flexpaie_payments.sql).
 *
 *   1. initiate: an invoice row (pending), then FlexPaie pushes the payment
 *      prompt to the agent's phone. The callback URL carries a one-off token
 *      whose SHA-256 is all we keep.
 *   2. settle: on FlexPaie's callback (token checked) or when the agent's page
 *      asks, we ask FlexPaie for the transaction's status. Only that answer
 *      can mark the invoice paid — a callback body is never trusted on its own.
 *   3. paid: in ONE transaction the invoice is re-checked still pending, the
 *      ordinary memberships row is written (lib/subscriptions.js
 *      assignPackageToAgent — the ledger every reader already uses), and the
 *      subscription is set active. A second callback finds it paid and does
 *      nothing.
 */

const CURRENCY_SYMBOLS = { USD: '$', CDF: 'FC' };

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function siteUrl() {
  return String(process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

async function logPayment(invoiceId, direction, event, httpStatus, payload, client = getPool()) {
  try {
    await client.query(
      'INSERT INTO payment_logs (invoice_id, direction, event, http_status, payload) VALUES ($1, $2, $3, $4, $5)',
      [invoiceId, direction, event, httpStatus ?? null, payload == null ? null : JSON.stringify(redactForLog(payload))],
    );
  } catch (err) {
    console.error(`[payments] could not log ${event} for invoice #${invoiceId}: ${err.message}`);
  }
}

/**
 * @returns {Promise<{ok: true, invoiceId: number, reference: string} | {ok: false, error: string}>}
 *   `error` is a short code the route maps to an HTTP status.
 */
export async function startFlexpaiePayment({ agentId, packageId, phone }) {
  if (!isFlexpaieConfigured()) return { ok: false, error: 'not_configured' };
  const payerPhone = normaliseMobileMoneyPhone(phone);
  if (!payerPhone) return { ok: false, error: 'phone' };

  const pool = getPool();
  const { rows: agentRows } = await pool.query('SELECT id, vendor_id FROM agents WHERE id = $1 AND deleted_at IS NULL', [agentId]);
  const agent = agentRows[0];
  if (!agent) return { ok: false, error: 'agent' };
  if (!agent.vendor_id) return { ok: false, error: 'no_agency' };
  const { rows: packageRows } = await pool.query(
    'SELECT id, price, title FROM packages WHERE id = $1 AND status = 1 AND deleted_at IS NULL AND COALESCE(is_trial, 0) = 0',
    [packageId],
  );
  const pkg = packageRows[0];
  if (!pkg || !(Number(pkg.price) > 0)) return { ok: false, error: 'package' };

  // Package prices are list prices in USD (the plan picker shows them in $).
  const currency = 'USD';
  const token = randomBytes(24).toString('hex');
  const { rows: idRows } = await pool.query("SELECT nextval('invoices_id_seq') AS id");
  const invoiceId = Number(idRows[0].id);
  const reference = invoiceReference(invoiceId, new Date().getUTCFullYear(), randomBytes(2).toString('hex'));
  await pool.query(
    `INSERT INTO invoices (id, reference, vendor_id, agent_id, package_id, amount, currency, payer_phone, callback_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [invoiceId, reference, agent.vendor_id, agent.id, pkg.id, Number(pkg.price), currency, payerPhone, sha256(token)],
  );

  const callbackUrl = `${siteUrl()}/api/payments/flexpaie/webhook?invoice=${invoiceId}&token=${token}`;
  let sent;
  try {
    sent = await initiateFlexpaiePayment({ reference, phone: payerPhone, amount: pkg.price, currency, callbackUrl });
  } catch (err) {
    await logPayment(invoiceId, 'outbound', 'initiate', null, { error: err.message });
    await pool.query("UPDATE invoices SET status = 'failed', failed_at = NOW(), failure_reason = $2 WHERE id = $1", [invoiceId, `initiate: ${err.message}`.slice(0, 300)]);
    return { ok: false, error: 'provider' };
  }
  await logPayment(invoiceId, 'outbound', 'initiate', sent.httpStatus, { request: sent.request, response: sent.body });
  if (!sent.result.ok) {
    await pool.query("UPDATE invoices SET status = 'failed', failed_at = NOW(), failure_reason = $2 WHERE id = $1", [invoiceId, sent.result.message]);
    return { ok: false, error: 'provider' };
  }
  await pool.query('UPDATE invoices SET order_number = $2 WHERE id = $1', [invoiceId, sent.result.orderNumber]);
  return { ok: true, invoiceId, reference };
}

/** Constant-time check of a callback's token against the stored hash. */
export async function callbackTokenValid(invoiceId, token) {
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || typeof token !== 'string' || token.length < 16) return false;
  const { rows } = await getPool().query('SELECT callback_token_hash FROM invoices WHERE id = $1', [invoiceId]);
  if (!rows[0]) return false;
  const expected = Buffer.from(rows[0].callback_token_hash, 'hex');
  const given = Buffer.from(sha256(token), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function recordCallback(invoiceId, payload) {
  await logPayment(invoiceId, 'inbound', 'callback', null, payload);
}

async function markPaid(invoiceId, orderNumber) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT * FROM invoices WHERE id = $1 AND status = 'pending' FOR UPDATE", [invoiceId]);
    const invoice = rows[0];
    if (!invoice) {
      await client.query('ROLLBACK');
      return 'already_settled';
    }
    const { membershipId } = await assignPackageToAgent({
      client,
      agentId: Number(invoice.agent_id),
      packageId: Number(invoice.package_id),
      price: Number(invoice.amount),
      currency: invoice.currency,
      currencySymbol: CURRENCY_SYMBOLS[invoice.currency] || null,
      paymentMethod: 'FlexPaie',
      transactionId: orderNumber,
      receipt: invoice.reference,
    });
    const { rows: memRows } = await client.query('SELECT start_date, expire_date FROM memberships WHERE id = $1', [membershipId]);
    const { rows: subRows } = await client.query(
      `INSERT INTO subscriptions (vendor_id, agent_id, package_id, status, current_period_start, current_period_end, membership_id)
       VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING id`,
      [invoice.vendor_id, invoice.agent_id, invoice.package_id, memRows[0]?.start_date ?? null, memRows[0]?.expire_date ?? null, membershipId],
    );
    await client.query(
      "UPDATE invoices SET status = 'paid', paid_at = NOW(), membership_id = $2, subscription_id = $3, failure_reason = NULL WHERE id = $1",
      [invoiceId, membershipId, subRows[0].id],
    );
    await client.query('COMMIT');
    return 'paid';
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ask FlexPaie where one invoice stands and act on the answer.
 * @returns {Promise<'paid'|'failed'|'pending'|'mismatch'|'already_settled'|'not_found'>}
 */
export async function settleInvoice(invoiceId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, reference, amount, currency, status, order_number FROM invoices WHERE id = $1', [invoiceId]);
  const invoice = rows[0];
  if (!invoice) return 'not_found';
  if (invoice.status !== 'pending') return 'already_settled';
  if (!invoice.order_number || !isFlexpaieConfigured()) return 'pending';

  const check = await checkFlexpaieTransaction(invoice.order_number);
  await logPayment(invoice.id, 'outbound', 'status_check', check.httpStatus, check.body);
  const verdict = readCheckResponse(check.body, invoice);
  if (verdict.state === 'paid') return markPaid(invoice.id, invoice.order_number);
  if (verdict.state === 'failed') {
    await pool.query("UPDATE invoices SET status = 'failed', failed_at = NOW(), failure_reason = $2 WHERE id = $1 AND status = 'pending'", [invoice.id, verdict.reason]);
    return 'failed';
  }
  if (verdict.state === 'mismatch') {
    // Money may have moved: never credited automatically, never marked failed.
    console.error(`[payments] invoice #${invoice.id} (${invoice.reference}) FlexPaie answer does not match: ${verdict.reason}`);
    await pool.query('UPDATE invoices SET failure_reason = $2 WHERE id = $1', [invoice.id, `à vérifier : ${verdict.reason}`]);
  }
  return verdict.state;
}

/** An agent's own invoice, for the status poll. Another agency's id is null. */
export async function getInvoiceForAgent(agentId, invoiceId) {
  const { rows } = await getPool().query(
    `SELECT i.id, i.reference, i.status, i.amount, i.currency, i.created_at, i.paid_at
     FROM invoices i JOIN agents a ON a.vendor_id = i.vendor_id
     WHERE i.id = $1 AND a.id = $2`,
    [invoiceId, agentId],
  );
  return rows[0] || null;
}
