import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPool } from './db';
import { assignPackageToAgent } from './subscriptions';
import { checkFlexpaieTransaction, initiateFlexpaiePayment, isFlexpaieConfigured } from './flexpaie';
import { invoiceReference, normaliseMobileMoneyPhone, readCheckResponse, redactForLog } from './flexpaieRules';
import { renewalStart } from './maishapayRules';

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

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function siteUrl() {
  return String(process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

export async function logPayment(invoiceId, direction, event, httpStatus, payload, client = getPool()) {
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

/**
 * Paid = one transaction: the ordinary memberships row, the invoice paid, the
 * subscription active. FlexPaie invoices keep exactly the behaviour they had
 * (a new subscription row each payment). A MaishaPay invoice also carries the
 * agent's renewal choice: a renewal invoice (created by the monthly sweep,
 * lib/subscriptionRenewals.js) extends ITS subscription from where the paid
 * period ends; a first payment opens a subscription with the renewal details
 * and closes any other active one of the agency, so one agency never gets two
 * monthly prompts.
 * @param {{paymentMethod?: string}} [options]
 */
export async function markPaid(invoiceId, orderNumber, { paymentMethod = 'FlexPaie' } = {}) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT * FROM invoices WHERE id = $1 AND status = 'pending' FOR UPDATE", [invoiceId]);
    const invoice = rows[0];
    if (!invoice) {
      await client.query('ROLLBACK');
      return 'already_settled';
    }
    const isMaishapay = invoice.provider === 'maishapay';
    let renewing = null;
    if (isMaishapay && invoice.is_renewal && invoice.subscription_id) {
      const { rows: subs } = await client.query('SELECT id, current_period_end FROM subscriptions WHERE id = $1 FOR UPDATE', [invoice.subscription_id]);
      renewing = subs[0] || null;
    } else if (isMaishapay) {
      // Paying again for the plan the agency is already on (early, by hand):
      // that subscription is extended rather than a second one opened.
      const { rows: subs } = await client.query(
        `SELECT id, current_period_end FROM subscriptions
          WHERE vendor_id = $1 AND package_id = $2 AND status = 'active' AND provider = 'maishapay'
          ORDER BY current_period_end DESC NULLS LAST LIMIT 1 FOR UPDATE`,
        [invoice.vendor_id, invoice.package_id],
      );
      renewing = subs[0] || null;
    }
    const { membershipId } = await assignPackageToAgent({
      client,
      agentId: Number(invoice.agent_id),
      packageId: Number(invoice.package_id),
      price: Number(invoice.amount),
      currency: invoice.currency,
      currencySymbol: CURRENCY_SYMBOLS[invoice.currency] || null,
      paymentMethod,
      transactionId: orderNumber,
      receipt: invoice.reference,
      startFrom: renewing ? renewalStart(renewing.current_period_end) : null,
    });
    const { rows: memRows } = await client.query('SELECT start_date, expire_date FROM memberships WHERE id = $1', [membershipId]);
    const periodStart = memRows[0]?.start_date ?? null;
    const periodEnd = memRows[0]?.expire_date ?? null;
    let subscriptionId;
    if (renewing) {
      await client.query(
        `UPDATE subscriptions SET status = 'active', current_period_start = $2, current_period_end = $3, membership_id = $4,
                renewal_attempts = 0, renewal_notified_at = NULL, updated_at = NOW()
          WHERE id = $1`,
        [renewing.id, periodStart, periodEnd, membershipId],
      );
      if (!invoice.is_renewal) {
        // The agent chose again on the checkout page: their latest choice wins.
        const mobile = invoice.payment_channel === 'mobile_money';
        await client.query(
          `UPDATE subscriptions SET auto_renew = $2, renewal_channel = $3, renewal_provider = $4, renewal_phone = $5,
                  cancelled_at = CASE WHEN $2 THEN NULL ELSE cancelled_at END
            WHERE id = $1`,
          [renewing.id, Boolean(invoice.auto_renew), invoice.payment_channel, invoice.wallet_provider, mobile ? invoice.payer_phone : null],
        );
      }
      subscriptionId = renewing.id;
    } else if (isMaishapay) {
      const mobile = invoice.payment_channel === 'mobile_money';
      const { rows: subRows } = await client.query(
        `INSERT INTO subscriptions (vendor_id, agent_id, package_id, status, current_period_start, current_period_end, membership_id,
                                    provider, auto_renew, renewal_channel, renewal_provider, renewal_phone)
         VALUES ($1, $2, $3, 'active', $4, $5, $6, 'maishapay', $7, $8, $9, $10) RETURNING id`,
        [
          invoice.vendor_id, invoice.agent_id, invoice.package_id, periodStart, periodEnd, membershipId,
          Boolean(invoice.auto_renew), invoice.payment_channel, invoice.wallet_provider, mobile ? invoice.payer_phone : null,
        ],
      );
      subscriptionId = subRows[0].id;
      await client.query(
        "UPDATE subscriptions SET status = 'expired', auto_renew = FALSE, updated_at = NOW() WHERE vendor_id = $1 AND status = 'active' AND id <> $2",
        [invoice.vendor_id, subscriptionId],
      );
    } else {
      const { rows: subRows } = await client.query(
        `INSERT INTO subscriptions (vendor_id, agent_id, package_id, status, current_period_start, current_period_end, membership_id)
         VALUES ($1, $2, $3, 'active', $4, $5, $6) RETURNING id`,
        [invoice.vendor_id, invoice.agent_id, invoice.package_id, periodStart, periodEnd, membershipId],
      );
      subscriptionId = subRows[0].id;
    }
    await client.query(
      "UPDATE invoices SET status = 'paid', paid_at = NOW(), membership_id = $2, subscription_id = $3, failure_reason = NULL WHERE id = $1",
      [invoiceId, membershipId, subscriptionId],
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
 * Ask the invoice's provider where it stands and act on the answer
 * (FlexPaie here, MaishaPay in lib/maishapayPayments.js).
 * @returns {Promise<'paid'|'failed'|'pending'|'mismatch'|'already_settled'|'not_found'>}
 */
export async function settleInvoice(invoiceId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT id, reference, amount, currency, status, order_number, provider FROM invoices WHERE id = $1', [invoiceId]);
  const invoice = rows[0];
  if (!invoice) return 'not_found';
  if (invoice.status !== 'pending') return 'already_settled';
  if (invoice.provider === 'maishapay') {
    // Imported lazily: lib/maishapayPayments.js imports this module.
    const { settleMaishapayInvoice } = await import('./maishapayPayments');
    return settleMaishapayInvoice(invoice);
  }
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
    `SELECT i.id, i.reference, i.status, i.amount, i.currency, i.created_at, i.paid_at, i.provider, i.package_id
     FROM invoices i JOIN agents a ON a.vendor_id = i.vendor_id
     WHERE i.id = $1 AND a.id = $2`,
    [invoiceId, agentId],
  );
  return rows[0] || null;
}
