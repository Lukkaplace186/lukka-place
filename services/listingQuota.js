/**
 * services/listingQuota.js
 *
 * The plan's listing limit on the WhatsApp path: an agent confirming a draft
 * with "OK" is refused when publishing it would exceed
 * `packages.number_of_property` of their agency's active membership. Same rules
 * and same SQL as web/lib/listingQuotaRules.js + web/lib/listingQuota.js —
 * change one, change the other:
 *   - counted: visible, not rejected, not closed listings of every agent of the
 *     agency (pending ones count);
 *   - the most generous active listing plan applies; a package with no listing
 *     allowance (0/NULL) sets no cap; no active membership → no cap.
 *
 * The sender is identified like services/postgres.js's resolveAgentId: a
 * verified agent whose digits match the wa_id. Anyone else has no plan to
 * enforce. Fails OPEN — Postgres unreachable must never be the reason an
 * agent's listing is refused; the publish sync would retry against it anyway.
 */

const { getPool, isConfigured } = require('./postgres');

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
const UPGRADE_URL = `${SITE_URL}/compte/agent/abonnement`;

const QUOTA_COUNTED_SQL = "p.status = 1 AND p.approve_status IN (0, 1) AND COALESCE(p.listing_status, 'active') <> 'closed'";

const SENDER_QUOTA_SQL = `
  SELECT a.id, a.vendor_id, q.listing_limit, q.plan_title,
         (SELECT COUNT(*)::int FROM properties p
          WHERE ${QUOTA_COUNTED_SQL}
            AND (p.agent_id = a.id
                 OR (a.vendor_id IS NOT NULL AND a.vendor_id <> 0
                     AND p.agent_id IN (SELECT o.id FROM agents o WHERE o.vendor_id = a.vendor_id)))) AS used
  FROM agents a
  LEFT JOIN LATERAL (
    SELECT pk.number_of_property AS listing_limit, pk.title AS plan_title
    FROM memberships m JOIN packages pk ON pk.id = m.package_id
    WHERE m.vendor_id = a.vendor_id AND m.status = 1 AND m.expire_date > NOW() AND pk.number_of_property > 0
    ORDER BY pk.number_of_property DESC, m.expire_date DESC
    LIMIT 1
  ) q ON true
  WHERE regexp_replace(a.phone, '\\D', '', 'g') = $1 AND a.phone_verified_at IS NOT NULL
  ORDER BY a.id
  LIMIT 1`;

/** How many listings confirming this draft publishes: a multi-unit building or a multi-property paste is several. */
function listingsToPublish(draft) {
  const parsed = draft?.parsed_json || {};
  const units = Array.isArray(parsed.units) ? parsed.units.filter(Boolean) : [];
  return (parsed.is_multi_unit || parsed.is_multi_property) && units.length >= 2 ? units.length : 1;
}

/** Pure: the verdict for known numbers. */
function quotaVerdict({ limit, used, planTitle = null }, adding = 1) {
  const cap = Number(limit) > 0 ? Math.floor(Number(limit)) : null;
  const count = Math.max(0, Math.floor(Number(used) || 0));
  if (cap == null) return { capped: false, blocked: false, limit: null, used: count, planTitle };
  const remaining = Math.max(0, cap - count);
  return { capped: true, blocked: adding > remaining, limit: cap, used: count, remaining, adding, planTitle };
}

/**
 * @returns {Promise<ReturnType<typeof quotaVerdict>|null>} null when there is no
 * verified agent for this number, no Postgres, or the lookup failed.
 */
async function checkQuotaForSender(waId, adding = 1) {
  if (!isConfigured()) return null;
  const digits = String(waId || '').replace(/\D/g, '');
  if (!digits) return null;
  try {
    const { rows } = await getPool().query(SENDER_QUOTA_SQL, [digits]);
    if (!rows[0]) return null;
    return quotaVerdict({ limit: rows[0].listing_limit, used: rows[0].used, planTitle: rows[0].plan_title }, adding);
  } catch (err) {
    console.warn(`[quota] lookup failed for ${waId}, not blocking: ${err.message}`);
    return null;
  }
}

/** The WhatsApp reply when a confirmation is refused. The draft stays pending. */
function limitReachedReply(verdict) {
  const plan = verdict.planTitle ? ` (${verdict.planTitle})` : '';
  return [
    `⚠️ Vous avez atteint la limite de ${verdict.limit} annonces pour votre forfait actuel${plan}.`,
    verdict.adding > 1
      ? `Ce message contient ${verdict.adding} biens, et il vous reste ${verdict.remaining} place(s) : il n’est pas publié pour le moment.`
      : 'Ce bien est gardé en attente : il n’est pas publié pour le moment.',
    '',
    `Pour publier plus d’annonces et booster votre visibilité, mettez à jour votre abonnement : ${UPGRADE_URL}`,
    '',
    'Vous pouvez aussi archiver une annonce depuis votre tableau de bord, puis répondre *OK* ici.',
  ].join('\n');
}

module.exports = {
  checkQuotaForSender,
  quotaVerdict,
  listingsToPublish,
  limitReachedReply,
  UPGRADE_URL,
  SENDER_QUOTA_SQL,
};
