/**
 * services/leadDispatch.js
 *
 * The automated matching engine: the moment a customer request exists, rank
 * the real agencies covering its commune and push it to the best seven on
 * WhatsApp.
 *
 * WHY THIS IS A PUSH
 * ------------------
 * The previous mechanism was a pull: an "Agent Demand Feed" tab an agent had
 * to remember to open, filtered to their communes. It has been removed from
 * the agent dashboard entirely. A pull feed fails for the same reason every
 * marketplace inbox fails — the agents who check it hourly take everything,
 * the rest never see a lead, and the customer's request sits unanswered while
 * seven agencies who would have wanted it were never told it existed. This
 * module is the inversion: nobody has to go looking.
 *
 * THE PIPELINE
 *   1. rank      services/agentRanking.js scores every agency covering the
 *                commune, in SQL, against real listing inventory.
 *   2. adjust    responsiveness and fairness, from this engine's own
 *                lead_matches / lead_proposals history (SQLite).
 *   3. select    the top 7.
 *   4. record    one lead_matches row per agency, BEFORE sending — so a crash
 *                mid-sweep still leaves evidence of who was selected.
 *   5. notify    a real WhatsApp send per agency, each independently
 *                try/caught. One agency's failed send never stops the rest.
 *
 * FAILURE POSTURE
 * Dispatch is best-effort and never throws into the caller. A request being
 * saved is the transaction that matters; matching is what happens next. If
 * Postgres is unreachable, if no agency covers the commune, or if every
 * WhatsApp send fails, the request still exists, is still visible in /admin,
 * and can still be dispatched again later — `INSERT OR IGNORE` on
 * (lead_id, agent_id) makes a re-run safe.
 */

const db = require('./db');
const chakra = require('./chakra');
const { rankAgentsForRequest, MAX_AGENTS_PER_LEAD } = require('./agentRanking');

/**
 * Template name/language as approved in Meta's WhatsApp Manager. Env-driven
 * for exactly the reason AGENT_OTP_TEMPLATE and SEARCH_ALERT_TEMPLATE already
 * are: an approval over there must never require a code change over here.
 */
const TEMPLATE_NAME = process.env.AGENT_LEAD_MATCH_TEMPLATE || 'agent_lead_match';
const TEMPLATE_LANG = process.env.AGENT_LEAD_MATCH_TEMPLATE_LANG || 'fr';

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** Rolling window for the responsiveness and fairness signals. */
const HISTORY_WINDOW_DAYS = 30;

/**
 * How much a perfectly-responsive agency is favoured over one that has
 * ignored everything: ×1.25 down to ×0.75. Deliberately a modest band — a bad
 * month should cost an agency position, not exile them from the rotation
 * permanently with no way back (they'd never get a lead to respond to again,
 * which makes the penalty self-reinforcing and permanent).
 */
const RESPONSIVENESS_FLOOR = 0.75;
const RESPONSIVENESS_CEILING = 1.25;

/**
 * Fairness damping. An agency already pushed a lot of leads this window is
 * nudged down so a busy commune's flow spreads across its agencies instead of
 * concentrating on whoever happens to rank highest on static signals. Caps out
 * at ×0.8 so it can reorder near-ties without overriding a genuinely much
 * better match.
 */
const FAIRNESS_SOFT_CAP = 15;
const FAIRNESS_FLOOR = 0.8;

function windowStartIso(days = HISTORY_WINDOW_DAYS) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Responsiveness multiplier for one agency.
 *
 * An agency with fewer than 3 pushes in the window is NEUTRAL (1.0), not
 * zero-scored: one ignored lead out of one is not evidence of anything, and
 * treating it as a 0% response rate would lock every newly-onboarded agency
 * out of the rotation on their first miss.
 */
function responsivenessMultiplier(stats) {
  if (!stats || stats.matched < 3) return 1;
  const rate = stats.answered / stats.matched;
  return RESPONSIVENESS_FLOOR + rate * (RESPONSIVENESS_CEILING - RESPONSIVENESS_FLOOR);
}

function fairnessMultiplier(recentMatches) {
  if (!recentMatches || recentMatches <= 0) return 1;
  const ratio = Math.min(recentMatches / FAIRNESS_SOFT_CAP, 1);
  return 1 - ratio * (1 - FAIRNESS_FLOOR);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString('fr-FR')} $`;
}

/** "1 200 $ – 2 000 $", "jusqu'à 2 000 $", "à partir de 800 $", or null. */
function budgetLabel(lead) {
  const min = money(lead.price_min);
  const max = money(lead.price_max);
  if (min && max) return `${min} – ${max}`;
  if (max) return `jusqu'à ${max}`;
  if (min) return `à partir de ${min}`;
  return null;
}

/**
 * The five template variables, in the order the approved `agent_lead_match`
 * template declares them. Every one is a real value off the lead row, with an
 * explicit placeholder where the customer genuinely didn't say — Meta rejects
 * an empty string parameter outright, so "Non précisé" is a required honest
 * stand-in rather than a fabricated value.
 */
function templateParams(lead, agent, link) {
  return [
    agent.display_name || agent.agency_name || 'Agent',
    lead.commune || 'Kinshasa',
    lead.bedrooms != null ? String(lead.bedrooms) : 'Non précisé',
    budgetLabel(lead) || 'Budget non précisé',
    link,
  ];
}

/**
 * The plain-text fallback, used when the template send fails.
 *
 * This is not redundancy for its own sake: a WhatsApp template is only
 * *required* to open a conversation outside the 24-hour customer-service
 * window. An agency that messaged the engine recently (which, on a
 * WhatsApp-first intake platform, is most active agencies most of the time)
 * can be reached with a normal message. So when the template is missing or
 * unapproved, a real message still lands for a large share of agents instead
 * of the whole feature silently doing nothing until Meta approves a template.
 */
function fallbackText(lead, agent, link) {
  const lines = [
    `Bonjour ${agent.display_name || ''}`.trim() + ',',
    '',
    `Nouvelle demande client à ${lead.commune || 'Kinshasa'} :`,
  ];
  if (lead.transaction_type) lines.push(`• Type : ${lead.transaction_type === 'vente' ? 'Achat' : 'Location'}`);
  if (lead.bedrooms != null) lines.push(`• Chambres : ${lead.bedrooms}`);
  const budget = budgetLabel(lead);
  if (budget) lines.push(`• Budget : ${budget}`);
  if (lead.quartier) lines.push(`• Quartier : ${lead.quartier}`);
  lines.push('', 'Répondez vite pour proposer un bien :', link);
  return lines.join('\n');
}

/**
 * Deep link into the agent's own dashboard, focused on this request.
 * /compte/agent/demandes reads `?lead=` and pins that request to the top.
 */
function agentLink(leadId) {
  return `${SITE_URL}/compte/agent/demandes?lead=${leadId}`;
}

/**
 * Ranks, records and notifies. Safe to call more than once for the same lead.
 *
 * @param {Object} lead A real `leads` row (db.createLead's return value).
 * @param {Object} [options]
 * @param {number} [options.limit] How many agencies to push to.
 * @returns {Promise<{dispatched: number, notified: number, failed: number, skipped?: string}>}
 */
async function dispatchLead(lead, { limit = MAX_AGENTS_PER_LEAD } = {}) {
  if (!lead || !lead.id) return { dispatched: 0, notified: 0, failed: 0, skipped: 'no-lead' };

  // A request with no commune cannot be routed to anyone honestly — coverage
  // is the whole basis of the match. It stays visible in /admin for a human
  // to route by hand rather than being blasted at every agency in the city.
  if (!lead.commune) {
    console.log(`[dispatch] lead #${lead.id} has no commune — not dispatched`);
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'no-commune' };
  }

  let ranked;
  try {
    ranked = await rankAgentsForRequest({
      commune: lead.commune,
      priceMin: lead.price_min ?? null,
      priceMax: lead.price_max ?? null,
      bedrooms: lead.bedrooms ?? null,
      transactionType: lead.transaction_type ?? null,
    }, limit);
  } catch (err) {
    console.error(`[dispatch] ranking failed for lead #${lead.id}: ${err.message}`);
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'ranking-failed' };
  }

  if (!ranked.length) {
    console.log(`[dispatch] no agency covers ${lead.commune} — lead #${lead.id} not dispatched`);
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'no-coverage' };
  }

  // Adjust by this engine's own history. Both signals come from real rows;
  // an agency with no history is neutral on both, by construction.
  const since = windowStartIso();
  let responsiveness = new Map();
  try {
    responsiveness = db.getAgentResponsivenessSince({ since });
  } catch (err) {
    // A missing history table or a read failure must not stop the dispatch —
    // it only means every agency scores neutrally on responsiveness, which is
    // exactly the state a fresh install is in anyway.
    console.warn(`[dispatch] responsiveness unavailable: ${err.message}`);
  }

  const selected = ranked
    .map((agent) => {
      let recent = 0;
      try {
        recent = db.countAgentMatchesSince({ agentId: agent.agent_id, since });
      } catch {
        recent = 0;
      }
      const score =
        agent.base_score *
        responsivenessMultiplier(responsiveness.get(agent.agent_id)) *
        fairnessMultiplier(recent);
      return { ...agent, score };
    })
    .sort((a, b) => b.score - a.score || b.matching_listings - a.matching_listings || a.agent_id - b.agent_id)
    .slice(0, limit);

  const link = agentLink(lead.id);
  let notified = 0;
  let failed = 0;

  // Sequential, not Promise.all: these are outbound WhatsApp sends against a
  // rate-limited API, and seven simultaneous requests per submitted lead is
  // how a burst of requests turns into throttling. Seven sequential sends is
  // well under a second of real latency and this whole function is already
  // running detached from the caller's response.
  for (const [index, agent] of selected.entries()) {
    const rank = index + 1;

    // Recorded BEFORE the send: a crash between here and the send still
    // leaves a durable record that this agency was selected, which is what
    // makes a re-dispatch idempotent rather than a duplicate notification.
    const { created } = db.recordLeadMatch({
      leadId: lead.id,
      agentId: agent.agent_id,
      agentPhone: agent.phone,
      rank,
      score: agent.score,
    });
    if (!created) continue; // already pushed to this agency for this lead

    try {
      try {
        await chakra.sendTemplate(agent.phone, TEMPLATE_NAME, {
          languageCode: TEMPLATE_LANG,
          bodyParams: templateParams(lead, agent, link),
        });
      } catch (templateErr) {
        // See fallbackText's doc comment — a template failure is very often
        // "not approved yet", not "this agent is unreachable".
        console.warn(
          `[dispatch] template '${TEMPLATE_NAME}' failed for agent #${agent.agent_id}, ` +
            `falling back to a session message: ${templateErr.message}`,
        );
        await chakra.sendWhatsAppMessage(agent.phone, fallbackText(lead, agent, link), { previewUrl: true });
      }
      notified += 1;
    } catch (err) {
      failed += 1;
      db.markLeadMatchFailed({ leadId: lead.id, agentId: agent.agent_id, error: err.message });
      console.error(`[dispatch] notify agent #${agent.agent_id} for lead #${lead.id} failed: ${err.message}`);
    }
  }

  console.log(
    `[dispatch] lead #${lead.id} (${lead.commune}) -> ${selected.length} agent(s): ` +
      `${notified} notified, ${failed} failed`,
  );
  return { dispatched: selected.length, notified, failed };
}

/**
 * Fire-and-forget wrapper for the request-creation paths.
 *
 * Every caller creates the lead first and calls this second. The lead's
 * existence is the transaction that matters; the push is what happens after
 * it, and must never be able to fail the write or delay the reply the
 * customer is waiting on.
 */
function dispatchLeadInBackground(lead, options) {
  setImmediate(() => {
    dispatchLead(lead, options).catch((err) => {
      console.error(`[dispatch] unhandled failure for lead #${lead?.id}: ${err.message}`);
    });
  });
}

module.exports = {
  dispatchLead,
  dispatchLeadInBackground,
  // Exposed for scripts/verify-pipeline.js.
  responsivenessMultiplier,
  fairnessMultiplier,
  budgetLabel,
  templateParams,
  fallbackText,
  agentLink,
  MAX_AGENTS_PER_LEAD,
};
