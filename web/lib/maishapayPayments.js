import 'server-only';
import { randomBytes } from 'node:crypto';
import { getPool } from './db';
import { logPayment, markPaid, sha256, siteUrl } from './payments';
import { checkMaishapayTransaction, isMaishapayConfigured, startMaishapayCollection } from './maishapay';
import {
  MAISHAPAY_PROVIDER_LABELS,
  isValidProvider,
  maishapayReference,
  normaliseDrcMobile,
  readCheckResponse,
} from './maishapayRules';

/**
 * Plan payments through MaishaPay (migrations/20261112_maishapay_payments.sql).
 *
 *   1. start: an invoice row (pending, provider 'maishapay'), then MaishaPay is
 *      asked to collect. Mobile money: the operator pushes a PIN prompt to the
 *      payer's phone and the checkout page polls /api/payments/status. Card:
 *      MaishaPay answers with its card page, the browser goes there, and comes
 *      back through the callback URL.
 *   2. settle: on the callback (token checked), the agent's poll, or the
 *      return from the card page, MaishaPay's status check is asked. Only that
 *      answer can mark the invoice paid — never a callback body or the query
 *      string of a return URL.
 *   3. paid: lib/payments.js markPaid, in one transaction (the ordinary
 *      memberships row, the invoice, the subscription with the renewal choice).
 *
 * The callback URL is the same for both channels: a server POST from
 * MaishaPay is answered in JSON, a browser coming back from the card page is
 * sent on to /compte/agent/abonnement/retour (app/api/payments/maishapay/webhook).
 */

const ERROR_CODES = new Set(['not_configured', 'phone', 'agent', 'no_agency', 'package', 'provider', 'channel', 'terms', 'pending_exists']);
export { ERROR_CODES as MAISHAPAY_ERROR_CODES };

function callbackUrl(invoiceId, token) {
  return `${siteUrl()}/api/payments/maishapay/webhook?invoice=${invoiceId}&token=${token}`;
}

async function loadAgentAndPackage(pool, agentId, packageId) {
  const { rows: agentRows } = await pool.query(
    `SELECT a.id, a.vendor_id, a.phone,
            NULLIF(TRIM(CONCAT_WS(' ', ai.first_name, ai.last_name)), '') AS person_name
       FROM agents a
       LEFT JOIN LATERAL (SELECT first_name, last_name FROM agent_infos WHERE agent_id = a.id ORDER BY (language_id = 20) DESC, language_id LIMIT 1) ai ON TRUE
      WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [agentId],
  );
  const agent = agentRows[0] || null;
  const { rows: packageRows } = await pool.query(
    'SELECT id, price, title, term FROM packages WHERE id = $1 AND status = 1 AND deleted_at IS NULL AND COALESCE(is_trial, 0) = 0',
    [packageId],
  );
  return { agent, pkg: packageRows[0] || null };
}

/**
 * Create the invoice and ask MaishaPay to collect it.
 * @param {{agentId: number, packageId: number, channel: 'mobile_money'|'card', provider: string,
 *          phone?: string, autoRenew?: boolean, acceptedTerms?: boolean,
 *          renewalOf?: number|null}} params  `renewalOf` = subscription id (the sweep only)
 * @returns {Promise<{ok: true, invoiceId: number, reference: string, paymentUrl: string|null}
 *                 | {ok: false, error: string}>}
 */
export async function startMaishapayPayment({ agentId, packageId, channel, provider, phone, autoRenew = false, acceptedTerms = false, renewalOf = null }) {
  if (!isMaishapayConfigured()) return { ok: false, error: 'not_configured' };
  if (!['mobile_money', 'card'].includes(channel)) return { ok: false, error: 'channel' };
  if (!isValidProvider(channel, provider)) return { ok: false, error: 'provider' };
  if (!renewalOf && !acceptedTerms) return { ok: false, error: 'terms' };
  const payerPhone = channel === 'mobile_money' ? normaliseDrcMobile(phone) : (normaliseDrcMobile(phone) || null);
  if (channel === 'mobile_money' && !payerPhone) return { ok: false, error: 'phone' };

  const pool = getPool();
  const { agent, pkg } = await loadAgentAndPackage(pool, agentId, packageId);
  if (!agent) return { ok: false, error: 'agent' };
  if (!agent.vendor_id) return { ok: false, error: 'no_agency' };
  if (!pkg || !(Number(pkg.price) > 0)) return { ok: false, error: 'package' };

  // One open mobile-money prompt per agency at a time: a second tap while the
  // first prompt is still on the phone would charge twice.
  const { rows: open } = await pool.query(
    `SELECT id FROM invoices
      WHERE vendor_id = $1 AND provider = 'maishapay' AND status = 'pending' AND payment_channel = 'mobile_money'
        AND created_at > NOW() - INTERVAL '3 minutes'
      LIMIT 1`,
    [agent.vendor_id],
  );
  if (channel === 'mobile_money' && open.length) return { ok: false, error: 'pending_exists' };

  // Package prices are list prices in USD (the plan picker shows them in $).
  const currency = 'USD';
  const token = randomBytes(24).toString('hex');
  const { rows: idRows } = await pool.query("SELECT nextval('invoices_id_seq') AS id");
  const invoiceId = Number(idRows[0].id);
  const reference = maishapayReference(invoiceId, new Date().getUTCFullYear(), randomBytes(2).toString('hex'));
  await pool.query(
    `INSERT INTO invoices (id, reference, subscription_id, vendor_id, agent_id, package_id, amount, currency, provider,
                           payer_phone, callback_token_hash, payment_channel, wallet_provider, auto_renew, is_renewal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'maishapay', $9, $10, $11, $12, $13, $14)`,
    [
      invoiceId, reference, renewalOf, agent.vendor_id, agent.id, pkg.id, Number(pkg.price), currency,
      payerPhone, sha256(token), channel, provider, Boolean(autoRenew), Boolean(renewalOf),
    ],
  );

  let sent;
  try {
    sent = await startMaishapayCollection({
      reference,
      amount: pkg.price,
      currency,
      channel,
      provider,
      phone: payerPhone,
      customerName: agent.person_name,
      callbackUrl: callbackUrl(invoiceId, token),
    });
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
  if (sent.result.transactionId) {
    await pool.query('UPDATE invoices SET order_number = $2 WHERE id = $1', [invoiceId, sent.result.transactionId]);
  }
  return { ok: true, invoiceId, reference, paymentUrl: sent.result.paymentPage };
}

/**
 * Ask MaishaPay where one pending invoice stands and act on the answer.
 * Called from lib/payments.js settleInvoice for provider 'maishapay'.
 * @returns {Promise<'paid'|'failed'|'pending'|'mismatch'|'already_settled'>}
 */
export async function settleMaishapayInvoice(invoice) {
  if (!isMaishapayConfigured()) return 'pending';
  const pool = getPool();
  const check = await checkMaishapayTransaction(invoice.reference);
  await logPayment(invoice.id, 'outbound', 'status_check', check.httpStatus, check.body);
  const verdict = check.httpStatus >= 200 && check.httpStatus < 300 ? readCheckResponse(check.body, invoice) : { state: 'pending' };
  if (verdict.state === 'paid') {
    const { rows } = await pool.query('SELECT wallet_provider FROM invoices WHERE id = $1', [invoice.id]);
    const label = MAISHAPAY_PROVIDER_LABELS[rows[0]?.wallet_provider] || null;
    return markPaid(invoice.id, invoice.order_number || invoice.reference, { paymentMethod: label ? `MaishaPay · ${label}` : 'MaishaPay' });
  }
  if (verdict.state === 'failed') {
    await pool.query("UPDATE invoices SET status = 'failed', failed_at = NOW(), failure_reason = $2 WHERE id = $1 AND status = 'pending'", [invoice.id, verdict.reason]);
    return 'failed';
  }
  if (verdict.state === 'mismatch') {
    // Money may have moved: never credited automatically, never marked failed.
    console.error(`[payments] invoice #${invoice.id} (${invoice.reference}) MaishaPay answer does not match: ${verdict.reason}`);
    await pool.query('UPDATE invoices SET failure_reason = $2 WHERE id = $1', [invoice.id, `à vérifier : ${verdict.reason}`]);
  }
  return verdict.state;
}

/**
 * A pending mobile-money prompt nobody answered is closed after 15 minutes, so
 * the agent can try again and the invoice list stays honest. Asked once more
 * first: a late SUCCESS still wins.
 */
export async function expireStalePrompts() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, reference, amount, currency, status, order_number FROM invoices
      WHERE provider = 'maishapay' AND status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes'
      ORDER BY created_at LIMIT 100`,
  );
  let expired = 0;
  for (const invoice of rows) {
    const state = await settleMaishapayInvoice(invoice).catch(() => 'pending');
    if (state === 'pending') {
      const { rowCount } = await pool.query(
        "UPDATE invoices SET status = 'cancelled', failed_at = NOW(), failure_reason = 'sans réponse après 15 min' WHERE id = $1 AND status = 'pending'",
        [invoice.id],
      );
      expired += rowCount;
    }
  }
  return expired;
}

/**
 * The agency's current online subscription, for the Abonnement page. Null
 * when there is none — and before the migration has run (42703 / 42P01).
 */
export async function getAgentOnlineSubscription(agentId) {
  try {
    const { rows } = await getPool().query(
      `SELECT s.id, s.status, s.auto_renew, s.renewal_channel, s.renewal_provider, s.renewal_phone,
              s.current_period_end, s.package_id, s.cancelled_at
         FROM subscriptions s JOIN agents a ON a.vendor_id = s.vendor_id
        WHERE a.id = $1 AND s.status = 'active' AND s.provider = 'maishapay'
        ORDER BY s.current_period_end DESC NULLS LAST
        LIMIT 1`,
      [agentId],
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42703' || err.code === '42P01') return null;
    throw err;
  }
}

/** "Arrêter le renouvellement automatique": the agency's subscriptions stop renewing. The paid period stays. */
export async function stopAutoRenew(agentId) {
  const { rowCount } = await getPool().query(
    `UPDATE subscriptions s SET auto_renew = FALSE, cancelled_at = NOW(), updated_at = NOW()
       FROM agents a
      WHERE a.id = $1 AND s.vendor_id = a.vendor_id AND s.status = 'active' AND s.auto_renew`,
    [agentId],
  );
  return rowCount;
}

/** Turn automatic renewal back on for the agency's active MaishaPay subscription. */
export async function resumeAutoRenew(agentId) {
  const { rowCount } = await getPool().query(
    `UPDATE subscriptions s SET auto_renew = TRUE, cancelled_at = NULL, renewal_attempts = 0, renewal_notified_at = NULL, updated_at = NOW()
       FROM agents a
      WHERE a.id = $1 AND s.vendor_id = a.vendor_id AND s.status = 'active' AND s.provider = 'maishapay'
        AND s.renewal_channel IS NOT NULL`,
    [agentId],
  );
  return rowCount;
}
