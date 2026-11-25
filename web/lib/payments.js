import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPool } from './db';
import { assignPackageToAgent } from './subscriptions';
import { checkMaishapayTransaction, initiateMaishapayPayment, isMaishapayConfigured, isMaishapaySandbox } from './maishapay';
import { invoiceReference, maishapayProvider, normaliseMobileMoneyPhone, readCheckResponse, redactForLog, walletId } from './maishapayRules';

/**
 * Online plan payments through MaishaPay mobile money
 * (migrations/20261125_maishapay_payments.sql; FlexPaie, its predecessor,
 * was removed the same day).
 *
 *   1. initiate: an invoice row (pending), then MaishaPay pushes the payment
 *      prompt to the agent's phone on the operator they chose. The callback
 *      URL carries a one-off token whose SHA-256 is all we keep.
 *   2. settle: on MaishaPay's callback (token checked), right after initiate,
 *      or when the agent's page polls, we ask MaishaPay for the transaction
 *      by our own reference. Only that answer can mark the invoice paid — a
 *      callback body carries no signature and is never trusted on its own.
 *   3. paid: in ONE transaction the invoice is re-checked still pending, the
 *      ordinary memberships row is written (lib/subscriptions.js
 *      assignPackageToAgent — the ledger every reader already uses), and the
 *      subscription is set active. A second callback finds it paid and does
 *      nothing.
 * A sandbox payment (MAISHAPAY_MODE=sandbox) goes through the same steps; its
 * invoice has test_mode and its membership says 'MaishaPay (test)'.
 */

const CURRENCY_SYMBOLS = { USD: '$', CDF: 'FC' };
const PROVIDER = 'maishapay';

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

async function failInvoice(invoiceId, reason) {
  await getPool().query(
    "UPDATE invoices SET status = 'failed', failed_at = NOW(), failure_reason = $2 WHERE id = $1 AND status = 'pending'",
    [invoiceId, String(reason).slice(0, 300)],
  );
}

/**
 * @returns {Promise<{ok: true, invoiceId: number, reference: string} | {ok: false, error: string}>}
 *   `error` is a short code the route maps to an HTTP status and the page to
 *   a message (lib/checkoutRules.js initiateErrorKey).
 */
export async function startMobileMoneyPayment({ agentId, packageId, phone, operator }) {
  if (!isMaishapayConfigured()) return { ok: false, error: 'not_configured' };
  const payerPhone = normaliseMobileMoneyPhone(phone);
  if (!payerPhone) return { ok: false, error: 'phone' };
  const provider = maishapayProvider(operator);
  if (!provider) return { ok: false, error: 'operator' };

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
  const testMode = isMaishapaySandbox();
  const token = randomBytes(24).toString('hex');
  let invoiceId;
  let reference;
  try {
    const { rows: idRows } = await pool.query("SELECT nextval('invoices_id_seq') AS id");
    invoiceId = Number(idRows[0].id);
    reference = invoiceReference(invoiceId, new Date().getUTCFullYear(), randomBytes(2).toString('hex'));
    await pool.query(
      `INSERT INTO invoices (id, reference, vendor_id, agent_id, package_id, amount, currency, payer_phone, callback_token_hash,
                             provider, payer_operator, test_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [invoiceId, reference, agent.vendor_id, agent.id, pkg.id, Number(pkg.price), currency, payerPhone, sha256(token), PROVIDER, provider, testMode],
    );
  } catch (err) {
    // Before migrations/20261125_maishapay_payments.sql: no table (42P01),
    // no column (42703), or FlexPaie's provider check (23514). Closed, not a crash.
    if (['42P01', '42703', '23514'].includes(err.code)) {
      console.error(`[payments] MaishaPay invoice refused by the schema (${err.code}) — run migrations/20261125_maishapay_payments.sql`);
      return { ok: false, error: 'not_configured' };
    }
    throw err;
  }

  const callbackUrl = `${siteUrl()}/api/payments/maishapay/callback?invoice=${invoiceId}&token=${token}`;
  let sent;
  try {
    sent = await initiateMaishapayPayment({ reference, walletID: walletId(payerPhone), provider, amount: pkg.price, currency, callbackUrl });
  } catch (err) {
    // A timeout is not proof nothing happened: the invoice stays pending and
    // the page's polls look it up by reference.
    await logPayment(invoiceId, 'outbound', 'initiate', null, { error: err.message });
    if (err.name === 'TimeoutError') return { ok: true, invoiceId, reference };
    await failInvoice(invoiceId, `initiate: ${err.message}`);
    return { ok: false, error: 'provider' };
  }
  await logPayment(invoiceId, 'outbound', 'initiate', sent.httpStatus, { request: sent.request, response: sent.body });
  if (!sent.result.ok) {
    await failInvoice(invoiceId, sent.result.message);
    return { ok: false, error: sent.result.error === 'wallet' ? 'operator_phone' : 'provider' };
  }
  if (sent.result.transactionId) {
    await pool.query('UPDATE invoices SET order_number = $2 WHERE id = $1', [invoiceId, sent.result.transactionId]);
  }
  // The sandbox answers SUCCESS at once; a live payment answers PENDING.
  // Either way the status check decides.
  if (sent.result.state !== 'pending') {
    await settleInvoice(invoiceId).catch((err) => console.error(`[payments] settling #${invoiceId} after initiate failed: ${err.message}`));
  }
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

async function markPaid(invoiceId, transactionId) {
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
      paymentMethod: invoice.test_mode ? 'MaishaPay (test)' : 'MaishaPay',
      transactionId: transactionId || invoice.order_number || null,
      receipt: invoice.reference,
    });
    const { rows: memRows } = await client.query('SELECT start_date, expire_date FROM memberships WHERE id = $1', [membershipId]);
    const { rows: subRows } = await client.query(
      `INSERT INTO subscriptions (vendor_id, agent_id, package_id, status, current_period_start, current_period_end, membership_id)
       VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING id`,
      [invoice.vendor_id, invoice.agent_id, invoice.package_id, memRows[0]?.start_date ?? null, memRows[0]?.expire_date ?? null, membershipId],
    );
    await client.query(
      `UPDATE invoices SET status = 'paid', paid_at = NOW(), membership_id = $2, subscription_id = $3, failure_reason = NULL,
              order_number = COALESCE(order_number, $4)
       WHERE id = $1`,
      [invoiceId, membershipId, subRows[0].id, transactionId || null],
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
 * Ask MaishaPay where one invoice stands and act on the answer.
 * @returns {Promise<'paid'|'failed'|'pending'|'mismatch'|'already_settled'|'not_found'>}
 */
export async function settleInvoice(invoiceId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, reference, amount, currency, status, provider FROM invoices WHERE id = $1', [invoiceId]);
  const invoice = rows[0];
  if (!invoice) return 'not_found';
  if (invoice.status !== 'pending') return 'already_settled';
  // A legacy FlexPaie invoice is never looked up at MaishaPay.
  if (invoice.provider !== PROVIDER || !isMaishapayConfigured()) return 'pending';

  const check = await checkMaishapayTransaction(invoice.reference);
  await logPayment(invoice.id, 'outbound', 'status_check', check.httpStatus, check.body);
  const verdict = readCheckResponse(check.body, invoice);
  if (verdict.state === 'paid') return markPaid(invoice.id, verdict.transactionId);
  if (verdict.state === 'failed') {
    await failInvoice(invoice.id, verdict.reason);
    return 'failed';
  }
  if (verdict.state === 'mismatch') {
    // Money may have moved: never credited automatically, never marked failed.
    console.error(`[payments] invoice #${invoice.id} (${invoice.reference}) MaishaPay answer does not match: ${verdict.reason}`);
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
