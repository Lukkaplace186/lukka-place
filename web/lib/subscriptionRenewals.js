import 'server-only';
import { getPool } from './db';
import { pushToAccount, sendWhatsAppMessage } from './adminApi';
import { siteUrl } from './payments';
import { isMaishapayConfigured } from './maishapay';
import { expireStalePrompts, startMaishapayPayment } from './maishapayPayments';
import { MAISHAPAY_PROVIDER_LABELS, renewalDue } from './maishapayRules';

/**
 * "Abonnement automatique" (owner decision 2026-11-11): mobile money cannot be
 * charged without the payer, so each period the agent APPROVES a new payment.
 * Run daily by the engine's `subscription-renewals` job
 * (services/scheduler.js → POST /api/cron/subscription-renewals).
 *
 * For each active MaishaPay subscription with auto_renew, ending within a day,
 * not prompted in the last 20 hours, fewer than three prompts this period:
 *   - mobile money: a renewal invoice is created and MaishaPay pushes the PIN
 *     prompt to the saved number; the agent is told so (app first, WhatsApp
 *     otherwise) with the amount and how to stop;
 *   - card: no card is stored (MaishaPay offers no token we know of), so the
 *     agent is sent the checkout link for the same plan.
 * A paid renewal extends the subscription from where the paid period ends
 * (lib/payments.js markPaid). Three unanswered prompts end the attempts for
 * that period; three days after it ends the subscription is marked expired.
 * The membership itself expires on its own date, as every membership does.
 *
 * Idempotent per subscription: `renewal_notified_at` / `renewal_attempts` are
 * CLAIMED by an UPDATE before anything is sent, so a second run, a retry or a
 * second process cannot prompt twice. Messages go after the claim and never
 * throw into the sweep.
 */

const BATCH = 200;

function money(amount) {
  return `${Number(amount).toLocaleString('fr-FR')} $`;
}

function dateFr(value) {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Africa/Kinshasa' }).format(new Date(value));
}

function lastDigits(phone) {
  return String(phone || '').slice(-4);
}

/** The message, in French whatever the agent's UI language: it is a payment notice. */
export function renewalMessage({ channel, providerLabel, phone, packageTitle, price, periodEnd, checkoutUrl, manageUrl }) {
  if (channel === 'mobile_money') {
    return [
      `Renouvellement de votre forfait ${packageTitle} sur LukkaPlace.`,
      `Une demande de paiement de ${money(price)} vient d'arriver sur votre ${providerLabel} (numéro se terminant par ${lastDigits(phone)}). Entrez votre code PIN pour la valider.`,
      `Votre forfait actuel se termine le ${dateFr(periodEnd)}.`,
      `Pour arrêter le renouvellement automatique : ${manageUrl}`,
    ].join('\n\n');
  }
  return [
    `Votre forfait ${packageTitle} sur LukkaPlace se termine le ${dateFr(periodEnd)}.`,
    `Renouvelez-le par carte (${money(price)}) : ${checkoutUrl}`,
    `Pour arrêter le renouvellement automatique : ${manageUrl}`,
  ].join('\n\n');
}

async function notifyAgent(agent, text, { title, url }) {
  try {
    const { pushed } = await pushToAccount({
      userType: 'agent',
      userId: Number(agent.id),
      kind: 'subscription_renewal',
      refId: agent.subscription_id,
      title,
      body: text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 500),
      url,
      urgent: true,
      fallbackText: text,
    });
    if (pushed) return 'push';
    if (!agent.phone) return 'nobody';
    await sendWhatsAppMessage(agent.phone, text);
    return 'whatsapp';
  } catch (err) {
    console.error(`[renewals] notice to agent #${agent.id} failed: ${err.message}`);
    return 'failed';
  }
}

async function claim(pool, subscriptionId) {
  const { rows } = await pool.query(
    `UPDATE subscriptions
        SET renewal_notified_at = NOW(), renewal_attempts = renewal_attempts + 1, updated_at = NOW()
      WHERE id = $1 AND status = 'active' AND auto_renew
        AND (renewal_notified_at IS NULL OR renewal_notified_at < NOW() - INTERVAL '20 hours')
        AND renewal_attempts < 3
      RETURNING id`,
    [subscriptionId],
  );
  return rows.length === 1;
}

/**
 * @returns {Promise<{due: number, prompted: number, reminded: number, failed: number, expired: number, stalePrompts: number}>}
 */
export async function runRenewalSweep({ now = new Date() } = {}) {
  const counts = { due: 0, prompted: 0, reminded: 0, failed: 0, expired: 0, stalePrompts: 0 };
  if (!isMaishapayConfigured()) return { ...counts, skipped: 'not_configured' };
  const pool = getPool();

  counts.stalePrompts = await expireStalePrompts();

  const { rows } = await pool.query(
    `SELECT s.id AS subscription_id, s.status, s.auto_renew, s.current_period_end, s.renewal_attempts, s.renewal_notified_at,
            s.renewal_channel, s.renewal_provider, s.renewal_phone, s.package_id,
            a.id, a.phone, p.title AS package_title, p.price
       FROM subscriptions s
       JOIN agents a ON a.id = s.agent_id AND a.deleted_at IS NULL
       JOIN packages p ON p.id = s.package_id AND p.status = 1 AND p.deleted_at IS NULL
      WHERE s.status = 'active' AND s.auto_renew AND s.provider = 'maishapay'
        AND s.current_period_end <= $1::timestamptz + INTERVAL '1 day'
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'pending')
      ORDER BY s.current_period_end
      LIMIT ${BATCH}`,
    [now.toISOString()],
  );

  for (const sub of rows) {
    if (!renewalDue({ ...sub, status: 'active' }, now)) continue;
    counts.due += 1;
    if (!(await claim(pool, sub.subscription_id))) continue;

    const checkoutUrl = `${siteUrl()}/compte/agent/abonnement/payer?forfait=${sub.package_id}`;
    const manageUrl = `${siteUrl()}/compte/agent/abonnement`;
    const providerLabel = MAISHAPAY_PROVIDER_LABELS[sub.renewal_provider] || sub.renewal_provider;

    if (sub.renewal_channel === 'mobile_money' && sub.renewal_phone) {
      let started;
      try {
        started = await startMaishapayPayment({
          agentId: Number(sub.id),
          packageId: Number(sub.package_id),
          channel: 'mobile_money',
          provider: sub.renewal_provider,
          phone: sub.renewal_phone,
          renewalOf: Number(sub.subscription_id),
        });
      } catch (err) {
        started = { ok: false, error: err.message };
      }
      if (!started.ok) {
        counts.failed += 1;
        console.error(`[renewals] subscription #${sub.subscription_id}: prompt not sent (${started.error})`);
        // The agent still learns the plan is ending, with the link to pay.
        const text = renewalMessage({ channel: 'card', packageTitle: sub.package_title, price: sub.price, periodEnd: sub.current_period_end, checkoutUrl, manageUrl });
        const via = await notifyAgent({ ...sub, id: sub.id }, text, { title: 'Votre forfait arrive à échéance', url: '/compte/agent/abonnement' });
        console.log(`[renewals] subscription #${sub.subscription_id}: reminder via ${via}`);
        continue;
      }
      counts.prompted += 1;
      const text = renewalMessage({
        channel: 'mobile_money', providerLabel, phone: sub.renewal_phone, packageTitle: sub.package_title,
        price: sub.price, periodEnd: sub.current_period_end, manageUrl,
      });
      const via = await notifyAgent(sub, text, { title: `Validez le paiement sur votre ${providerLabel}`, url: '/compte/agent/abonnement' });
      console.log(`[renewals] subscription #${sub.subscription_id}: PIN prompt sent, invoice #${started.invoiceId}, notice via ${via}`);
    } else {
      counts.reminded += 1;
      const text = renewalMessage({ channel: 'card', packageTitle: sub.package_title, price: sub.price, periodEnd: sub.current_period_end, checkoutUrl, manageUrl });
      const via = await notifyAgent(sub, text, { title: 'Renouvelez votre forfait', url: `/compte/agent/abonnement/payer?forfait=${sub.package_id}` });
      console.log(`[renewals] subscription #${sub.subscription_id}: card reminder via ${via}`);
    }
  }

  const { rowCount } = await pool.query(
    `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
      WHERE status = 'active' AND provider = 'maishapay' AND current_period_end < $1::timestamptz - INTERVAL '3 days'`,
    [now.toISOString()],
  );
  counts.expired = rowCount;
  return counts;
}
