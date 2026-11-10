/**
 * services/leadDispatch.js
 *
 * The automated matching engine: an open customer request ("trouvez-moi un
 * bien") is offered to the agencies covering its commune, IN WAVES, and the
 * agencies answer with one tap — "Je m'en occupe" or "Pas dispo"
 * (services/leadClaims.js).
 *
 * WAVES (2026-11-10, owner decision — docs/claude/leads-and-enquiries.md,
 * "Matching in waves")
 * ---------------------------------------------------------------------------
 * Until then a request went to the best seven at the same second, so rank 1
 * had no advantage over rank 7, every alert read like a mass mailing, and on
 * production 0 of 7 alerts were answered. Now:
 *
 *   wave 1  the best 2, alone for WAVE_WINDOW_MS (30 min)
 *   wave 2  the next 3, if fewer than 3 agencies have claimed it
 *   wave 3  the next 2
 *   then    nobody claimed it -> the ops desk (OPS_WHATSAPP_NUMBER)
 *
 * Up to MAX_CLAIMS (3) agencies can take one request; the third claim closes
 * it. A wave whose every agency said "Pas dispo" moves on at once. The
 * waves are driven by the `lead-waves` scheduler job (runWaveSweep).
 *
 * WHO IS ASKED FIRST
 *   score = agentRanking base score (coverage, stock in the commune, stock
 *           fitting the budget, verified number) × plan multiplier
 *         × priority level multiplier (services/agentPriority.js: Or 1.25,
 *           Argent 1, Bronze 0.8 — keeping listings up to date, publishing,
 *           answering requests and visits)
 *         × fairness (an agency already sent many requests this month is
 *           nudged down so a busy commune spreads)
 *
 * NOBODY TO ASK
 *   no commune      -> the desk is told at once ("no-commune")
 *   no agency in it -> agencies of the neighbouring communes are asked, the
 *                      alert says so, and the desk is told ("no-coverage")
 *
 * FAILURE POSTURE
 * Best-effort, never throws into the caller. The request being saved is what
 * matters; a crash mid-wave leaves the lead_matches rows (written BEFORE each
 * send) and UNIQUE(lead_id, agent_id) makes a re-run a no-op for agencies
 * already asked.
 */

const db = require('./db');
const chakra = require('./chakra');
const { rankAgentsForRequest } = require('./agentRanking');
const { leadCommunes } = require('./leadCommunes');
const { neighbouringCommunes } = require('./communeNeighbours');
const agentPriority = require('./agentPriority');

/**
 * Templates, both read at call time and unset by default (an unapproved name
 * costs a failing round trip per agency):
 *
 *   AGENT_LEAD_CLAIM_TEMPLATE  the request alert WITH the two quick-reply
 *                              buttons (Je m'en occupe / Pas dispo) — draft in
 *                              docs/claude/whatsapp-delivery.md,
 *                              "agent_lead_claim". Not approved yet.
 *   AGENT_LEAD_MATCH_TEMPLATE  `agent_lead_match`, approved 2026-11-03 and on
 *                              in production: same 5 body variables (agency,
 *                              commune(s), bedrooms, budget, link), NO buttons
 *                              — the agency claims from the dashboard link.
 *                              Sending it with buttons would be refused.
 *
 * Both share AGENT_LEAD_MATCH_TEMPLATE_LANG.
 */
function claimTemplateName() {
  return process.env.AGENT_LEAD_CLAIM_TEMPLATE || null;
}
function templateName() {
  return process.env.AGENT_LEAD_MATCH_TEMPLATE || null;
}
function templateLang() {
  return process.env.AGENT_LEAD_MATCH_TEMPLATE_LANG || 'fr';
}

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** Agencies per wave, in order. Their sum is the most agencies one request reaches. */
const WAVE_SIZES = [2, 3, 2];
const MAX_AGENTS_PER_LEAD = WAVE_SIZES.reduce((a, b) => a + b, 0);
/** How long a wave has the request to itself. */
const WAVE_WINDOW_MS = 30 * 60 * 1000;
/** Agencies that may take one request. */
const MAX_CLAIMS = 3;
/** The sweep never wakes requests older than this (nor any created before waves). */
const SWEEP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Agencies ranked per commune — enough for every wave plus the adjustments. */
const RANK_FETCH = 20;

/** Rolling window for the fairness signal. */
const HISTORY_WINDOW_DAYS = 30;
const FAIRNESS_SOFT_CAP = 15;
const FAIRNESS_FLOOR = 0.8;

function windowStartIso(days = HISTORY_WINDOW_DAYS) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
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
 * "Gombe, Ngaliema" — every commune the request names, the one this agency
 * was matched on first. A neighbouring-commune match lists the requested
 * communes as they are (the agency's own commune is not one of them).
 */
function communesLabel(lead, agent) {
  const all = leadCommunes(lead);
  if (all.length === 0) return 'Kinshasa';
  const matched = agent?.neighbour_of ? null : agent?.matched_commune;
  if (!matched) return all.join(', ');
  const rest = all.filter((c) => c.toLowerCase() !== matched.toLowerCase());
  return [matched, ...rest].join(', ');
}

/**
 * One ranked list from one ranking per commune. An agency covering several
 * of the requested communes appears once, on its best score, and remembers
 * which commune earned it (`matched_commune`, plus `neighbour_of` for a
 * neighbouring-commune match). Scores are not summed.
 */
function mergeRankedAcrossCommunes(perCommune) {
  const byAgent = new Map();
  for (const { commune, neighbourOf = null, rows } of perCommune) {
    for (const row of rows || []) {
      const previous = byAgent.get(row.agent_id);
      if (!previous || row.base_score > previous.base_score) {
        byAgent.set(row.agent_id, { ...row, matched_commune: commune, neighbour_of: neighbourOf });
      }
    }
  }
  return [...byAgent.values()].sort((a, b) => b.base_score - a.base_score || a.agent_id - b.agent_id);
}

function templateParams(lead, agent, link) {
  return [
    agent.display_name || agent.agency_name || 'Agent',
    communesLabel(lead, agent),
    lead.bedrooms != null ? String(lead.bedrooms) : 'Non précisé',
    budgetLabel(lead) || 'Budget non précisé',
    link,
  ];
}

const WAVE_LINES = {
  1: `Vous êtes parmi les ${WAVE_SIZES[0]} premières agences prévenues : la demande est à vous seules pendant 30 min.`,
  2: 'La demande est maintenant ouverte à quelques autres agences.',
  3: 'Dernier appel avant que l’équipe Lukka Place ne prenne le relais.',
};

/**
 * The alert body (interactive message, or plain text when buttons fail).
 * `withButtons: false` replaces the button hint with the dashboard link hint.
 */
function alertText(lead, agent, link, { wave = 1, withButtons = true } = {}) {
  const lines = [`Bonjour ${agent.display_name || ''}`.trim() + ',', ''];
  if (agent.neighbour_of) {
    lines.push(
      `Nouvelle demande client à ${communesLabel(lead, agent)}. Aucune agence n’y est inscrite : nous vous la proposons car vous couvrez ${agent.matched_commune}, commune voisine.`,
    );
  } else {
    lines.push(`Nouvelle demande client à ${communesLabel(lead, agent)} :`);
  }
  // "Mon déménagement": why the customer is moving, in their answers' words.
  if (lead.move_story) lines.push(`• ${lead.move_story}`);
  if (lead.transaction_type) lines.push(`• Type : ${lead.transaction_type === 'vente' ? 'Achat' : 'Location'}`);
  if (lead.bedrooms != null) lines.push(`• Chambres : ${lead.bedrooms}`);
  const budget = budgetLabel(lead);
  if (budget) lines.push(`• Budget : ${budget}`);
  if (lead.quartier) lines.push(`• Quartier : ${lead.quartier}`);
  lines.push('', WAVE_LINES[wave] || WAVE_LINES[1]);
  if (withButtons) {
    lines.push(`Touchez « Je m’en occupe » pour recevoir le numéro du client (${MAX_CLAIMS} agences au plus).`);
  } else {
    lines.push(`Ouvrez la demande et touchez « Je m’en occupe » pour recevoir le numéro du client (${MAX_CLAIMS} agences au plus) :`);
  }
  lines.push(link);
  return lines.join('\n');
}

/** Kept for callers of the earlier plain-text alert (§80). */
function fallbackText(lead, agent, link) {
  return alertText(lead, agent, link, { withButtons: false });
}

function claimButtonId(matchId) {
  return `lead_claim:${matchId}`;
}
function passButtonId(matchId) {
  return `lead_pass:${matchId}`;
}
function alertButtons(matchId) {
  return [
    { id: claimButtonId(matchId), title: 'Je m’en occupe' },
    { id: passButtonId(matchId), title: 'Pas dispo' },
  ];
}

/**
 * Deep link into the agent's own dashboard, focused on this request.
 * /compte/agent/demandes reads `?lead=` and pins that request to the top.
 */
function agentLink(leadId) {
  return `${SITE_URL}/compte/agent/demandes?lead=${leadId}`;
}

function adminLink(leadId) {
  return `${SITE_URL}/admin/leads/${leadId}`;
}

// ---------------------------------------------------------------------------
// Desk alerts — once per request, whatever the reason, after the fact.
// ---------------------------------------------------------------------------

function customerLine(lead) {
  const digits = String(lead.wa_id || '').replace(/\D/g, '');
  return `• Client : ${lead.name || 'Nom non précisé'}${digits ? ` (+${digits})` : ''}`;
}

function requestLines(lead) {
  const out = [];
  const communes = leadCommunes(lead);
  if (communes.length) out.push(`• Commune : ${communes.join(', ')}`);
  if (lead.transaction_type) out.push(`• Type : ${lead.transaction_type === 'vente' ? 'Achat' : 'Location'}`);
  if (lead.bedrooms != null) out.push(`• Chambres : ${lead.bedrooms}`);
  const budget = budgetLabel(lead);
  if (budget) out.push(`• Budget : ${budget}`);
  if (lead.move_story) out.push(`• ${lead.move_story}`);
  if (!communes.length && lead.requirements_summary) {
    out.push(`• Demande : ${String(lead.requirements_summary).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  return out;
}

function deskText(lead, reason, { neighbours = [], asked = 0 } = {}) {
  const head = {
    'no-commune': '🧭 Demande client sans commune : aucune agence prévenue',
    'no-coverage': neighbours.length
      ? `📍 Aucune agence inscrite à ${leadCommunes(lead).join(', ')} : proposée aux communes voisines (${neighbours.join(', ')})`
      : `📍 Aucune agence inscrite à ${leadCommunes(lead).join(', ')} ni dans les communes voisines : personne n’a été prévenu`,
    unclaimed: `⏱️ Demande client sans preneur : ${asked} agence(s) prévenue(s), aucune ne l’a prise`,
  }[reason];
  return [
    head,
    '',
    customerLine(lead),
    ...requestLines(lead),
    '',
    reason === 'no-coverage' && neighbours.length
      ? 'À recruter dans cette commune. La demande :'
      : 'À traiter par l’équipe. La demande :',
    adminLink(lead.id),
  ].join('\n');
}

/**
 * Tell the ops desk about a request, at most once per request (the stamp is
 * taken BEFORE the send, so two paths cannot both alert). Never throws.
 */
async function alertDeskOnce(lead, reason, details = {}, { send } = {}) {
  try {
    const taken = db.db
      .prepare(
        `UPDATE leads SET dispatch_desk_alerted_at = CURRENT_TIMESTAMP, dispatch_desk_reason = ?
          WHERE id = ? AND dispatch_desk_alerted_at IS NULL`,
      )
      .run(reason, lead.id);
    if (taken.changes === 0) return { sent: false, reason: 'already-alerted' };
    const desk = String(process.env.OPS_WHATSAPP_NUMBER || '').replace(/\D/g, '');
    if (!desk) {
      console.error(`[dispatch] lead #${lead.id}: ${reason} and OPS_WHATSAPP_NUMBER is unset — nobody told`);
      return { sent: false, reason: 'no-desk' };
    }
    // eslint-disable-next-line global-require
    const sender = send || require('./deskAlert').sendDeskAlert;
    const via = await sender(desk, deskText(lead, reason, details), { label: `lead #${lead.id} ${reason}` });
    console.log(`[dispatch] lead #${lead.id}: desk told (${reason}, ${via})`);
    return { sent: true, via };
  } catch (err) {
    console.error(`[dispatch] lead #${lead.id}: desk alert (${reason}) failed — ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Ranking one wave
// ---------------------------------------------------------------------------

async function rankCommunes(lead, communes, rank, neighbourOf = null) {
  const perCommune = [];
  let failures = 0;
  for (const commune of communes) {
    try {
      const rows = await rank({
        commune,
        priceMin: lead.price_min ?? null,
        priceMax: lead.price_max ?? null,
        bedrooms: lead.bedrooms ?? null,
        transactionType: lead.transaction_type ?? null,
      }, RANK_FETCH);
      perCommune.push({ commune, neighbourOf: neighbourOf ? neighbourOf(commune) : null, rows });
    } catch (err) {
      failures += 1;
      console.error(`[dispatch] ranking failed for lead #${lead.id} in ${commune}: ${err.message}`);
    }
  }
  return { perCommune, failed: failures === communes.length && communes.length > 0 };
}

/**
 * Every agency that could be asked about this request, best first, with the
 * neighbouring-commune fallback applied when the requested communes have none.
 *
 * @returns {Promise<{ranked: Object[], skipped?: string, neighbours?: string[]}>}
 */
async function candidatesFor(lead, { rank, levels }) {
  const communes = leadCommunes(lead);
  const direct = await rankCommunes(lead, communes, rank);
  if (direct.failed) return { ranked: [], skipped: 'ranking-failed' };
  let ranked = mergeRankedAcrossCommunes(direct.perCommune);
  let neighbours = [];
  if (!ranked.length) {
    // No agency in any requested commune: the nearest communes of the same city.
    const owner = new Map();
    for (const c of communes) {
      for (const n of neighbouringCommunes(c)) {
        if (!owner.has(n.commune) && !communes.some((x) => x.toLowerCase() === n.commune.toLowerCase())) {
          owner.set(n.commune, c);
        }
      }
    }
    neighbours = [...owner.keys()];
    if (neighbours.length) {
      const around = await rankCommunes(lead, neighbours, rank, (n) => owner.get(n));
      ranked = mergeRankedAcrossCommunes(around.perCommune);
    }
    if (!ranked.length) return { ranked: [], skipped: 'no-coverage', neighbours: [] };
  }

  const since = windowStartIso();
  let levelMap = new Map();
  try {
    levelMap = (await levels(ranked.map((a) => a.agent_id))) || new Map();
  } catch (err) {
    console.warn(`[dispatch] priority levels unavailable: ${err.message}`);
  }
  const scored = ranked
    .map((agent) => {
      let recent = 0;
      try {
        recent = db.countAgentMatchesSince({ agentId: agent.agent_id, since });
      } catch {
        recent = 0;
      }
      const lvl = levelMap.get(agent.agent_id) || null;
      const score = agent.base_score * (lvl ? lvl.multiplier : 1) * fairnessMultiplier(recent);
      return { ...agent, score, level: lvl ? lvl.level : null };
    })
    .sort((a, b) => b.score - a.score
      || (b.fitting_listings || 0) - (a.fitting_listings || 0)
      || (b.matching_listings || 0) - (a.matching_listings || 0)
      || a.agent_id - b.agent_id);
  return { ranked: scored, neighbours: neighbours.filter((n) => scored.some((a) => a.matched_commune === n)) };
}

// ---------------------------------------------------------------------------
// Sending one wave
// ---------------------------------------------------------------------------

/**
 * One agency's alert, by its 24 h window (services/sessionWindow.js):
 *   inside   the interactive message with both buttons (the owner prefers a
 *            real message to a template inside the window);
 *   outside  the button template when approved, else `agent_lead_match`
 *            without buttons (its link opens the dashboard, where the agency
 *            claims), else the interactive message — which then probably
 *            does not arrive, and the log says so;
 *   last     plain text with the dashboard link.
 */
async function notifyAgency(lead, agent, matchId, wave) {
  const link = agentLink(lead.id);
  let inside = false;
  try {
    // eslint-disable-next-line global-require
    inside = require('./sessionWindow').insideSessionWindow(agent.phone);
  } catch {
    inside = false;
  }
  if (!inside) {
    const withButtons = claimTemplateName();
    const plain = templateName();
    for (const [name, buttons] of [[withButtons, true], [plain, false]]) {
      if (!chakra.templateConfigured(name)) continue;
      try {
        await chakra.sendTemplate(agent.phone, name, {
          languageCode: templateLang(),
          bodyParams: templateParams(lead, agent, link),
          ...(buttons ? { buttons: [{ id: claimButtonId(matchId) }, { id: passButtonId(matchId) }] } : {}),
        });
        return buttons ? 'template-buttons' : 'template';
      } catch (err) {
        console.warn(`[dispatch] template '${name}' failed for agent #${agent.agent_id}: ${err.message}`);
      }
    }
    console.warn(`[dispatch] agent #${agent.agent_id} is outside the 24 h window and no template went: the message below probably will not arrive`);
  }
  try {
    await chakra.sendInteractiveButtons(agent.phone, alertText(lead, agent, link, { wave }), alertButtons(matchId));
    return 'buttons';
  } catch (err) {
    console.warn(`[dispatch] buttons failed for agent #${agent.agent_id} (${err.message}) — plain text`);
  }
  await chakra.sendWhatsAppMessage(agent.phone, alertText(lead, agent, link, { wave, withButtons: false }), { previewUrl: true });
  return 'text';
}

/**
 * Send the next wave of this request (wave 1 for a new one). Safe to call
 * again: an agency already asked is skipped, and the wave number is taken
 * atomically so the sweep and an early advance cannot both send it.
 *
 * @param {Object} lead A real `leads` row.
 * @param {{rank?: Function, levels?: Function, deskSend?: Function, force?: boolean}} [options]
 * @returns {Promise<{dispatched: number, notified: number, failed: number, wave?: number, skipped?: string}>}
 */
async function dispatchNextWave(lead, {
  rank = rankAgentsForRequest, levels = agentPriority.computeLevels, deskSend, force = false,
} = {}) {
  if (!lead || !lead.id) return { dispatched: 0, notified: 0, failed: 0, skipped: 'no-lead' };
  const fresh = db.getLead(lead.id) || lead;
  const row = { ...lead, ...fresh };

  if (!db.isOpenRequestSource(row.source)) {
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'directed' };
  }
  if (row.dispatch_closed_at && !force) return { dispatched: 0, notified: 0, failed: 0, skipped: 'closed' };

  const communes = leadCommunes(row);
  if (communes.length === 0) {
    console.log(`[dispatch] lead #${row.id} has no commune — desk told, no agency`);
    await alertDeskOnce(row, 'no-commune', {}, { send: deskSend });
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'no-commune' };
  }

  const currentWave = Number(row.dispatch_wave) || 0;
  const nextWave = currentWave + 1;
  const asked = db.getLeadMatches(row.id);
  const claims = asked.filter((m) => m.claimed_at).length;

  if (claims >= MAX_CLAIMS) return closeDispatch(row, 'full');
  if (nextWave > WAVE_SIZES.length) return finishWaves(row, asked, { deskSend });

  const found = await candidatesFor(row, { rank, levels });
  if (found.skipped === 'ranking-failed') return { dispatched: 0, notified: 0, failed: 0, skipped: 'ranking-failed' };
  if (found.skipped === 'no-coverage') {
    console.log(`[dispatch] no agency covers ${communes.join(', ')} nor its neighbours — lead #${row.id} to the desk`);
    await alertDeskOnce(row, 'no-coverage', { neighbours: [] }, { send: deskSend });
    db.db.prepare('UPDATE leads SET dispatch_closed_at = CURRENT_TIMESTAMP WHERE id = ? AND dispatch_closed_at IS NULL').run(row.id);
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'no-coverage' };
  }
  if (found.neighbours && found.neighbours.length && currentWave === 0) {
    await alertDeskOnce(row, 'no-coverage', { neighbours: found.neighbours }, { send: deskSend });
  }

  const already = new Set(asked.map((m) => Number(m.agent_id)));
  const wave = found.ranked.filter((a) => !already.has(Number(a.agent_id))).slice(0, WAVE_SIZES[nextWave - 1]);
  if (wave.length === 0) return finishWaves(row, asked, { deskSend });

  // Take the wave number atomically: whoever loses the race sends nothing.
  const taken = db.db
    .prepare(
      `UPDATE leads SET dispatch_wave = ?, dispatch_wave_at = CURRENT_TIMESTAMP
        WHERE id = ? AND COALESCE(dispatch_wave, 0) = ?`,
    )
    .run(nextWave, row.id, currentWave);
  if (taken.changes === 0) return { dispatched: 0, notified: 0, failed: 0, skipped: 'wave-taken' };

  let notified = 0;
  let failed = 0;
  // Sequential: outbound sends against a rate-limited API.
  for (const [index, agent] of wave.entries()) {
    const { created, row: match } = db.recordLeadMatch({
      leadId: row.id,
      agentId: agent.agent_id,
      agentPhone: agent.phone,
      rank: asked.length + index + 1,
      score: Math.round(agent.score * 10) / 10,
      wave: nextWave,
      matchedCommune: agent.matched_commune || null,
      neighbourOf: agent.neighbour_of || null,
      level: agent.level || null,
    });
    if (!created) continue;
    try {
      const via = await notifyAgency(row, agent, match.id, nextWave);
      notified += 1;
      console.log(`[dispatch] lead #${row.id} wave ${nextWave}: agent #${agent.agent_id} asked (${via})`);
    } catch (err) {
      failed += 1;
      db.markLeadMatchFailed({ leadId: row.id, agentId: agent.agent_id, error: err.message });
      console.error(`[dispatch] lead #${row.id} wave ${nextWave}: agent #${agent.agent_id} NOT reached — ${err.message}`);
    }
  }

  console.log(
    `[dispatch] lead #${row.id} (${communes.join(', ')}) wave ${nextWave} -> ${wave.length} agency(ies): ${notified} sent, ${failed} failed`,
  );
  return { dispatched: wave.length, notified, failed, wave: nextWave };
}

function closeDispatch(lead, why) {
  db.db.prepare('UPDATE leads SET dispatch_closed_at = CURRENT_TIMESTAMP WHERE id = ? AND dispatch_closed_at IS NULL').run(lead.id);
  return { dispatched: 0, notified: 0, failed: 0, skipped: why };
}

/** Every wave spent (or nobody left to ask): close, and tell the desk if nobody took it. */
async function finishWaves(lead, asked, { deskSend } = {}) {
  closeDispatch(lead, 'waves-done');
  const claims = asked.filter((m) => m.claimed_at).length;
  if (claims === 0) {
    await alertDeskOnce(lead, 'unclaimed', { asked: asked.length }, { send: deskSend });
    return { dispatched: 0, notified: 0, failed: 0, skipped: 'unclaimed' };
  }
  return { dispatched: 0, notified: 0, failed: 0, skipped: 'waves-done' };
}

/** A new request: its first wave. */
function dispatchLead(lead, options) {
  return dispatchNextWave(lead, options);
}

/**
 * Fire-and-forget wrapper for the request-creation paths. The lead's
 * existence is the transaction that matters; the push must never be able to
 * fail the write or delay the reply the customer is waiting on.
 */
function dispatchLeadInBackground(lead, options) {
  setImmediate(() => {
    dispatchLead(lead, options).catch((err) => {
      console.error(`[dispatch] unhandled failure for lead #${lead?.id}: ${err.message}`);
    });
  });
}

/** SQLite's CURRENT_TIMESTAMP shape (UTC, no T/Z). */
function sqliteTs(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * The `lead-waves` job: every request whose current wave has had its 30
 * minutes, and is still taking agencies, gets its next wave (or, after the
 * last, goes to the desk if nobody took it). Each lead on its own; never throws.
 */
async function runWaveSweep({ now = Date.now(), ...options } = {}) {
  const result = { due: 0, advanced: 0 };
  let due = [];
  try {
    due = db.db
      .prepare(
        `SELECT * FROM leads
          WHERE dispatch_wave IS NOT NULL AND dispatch_closed_at IS NULL
            AND dispatch_wave_at <= ? AND created_at >= ?
          ORDER BY dispatch_wave_at LIMIT 50`,
      )
      .all(sqliteTs(now - WAVE_WINDOW_MS), sqliteTs(now - SWEEP_MAX_AGE_MS));
  } catch (err) {
    console.error(`[dispatch] wave sweep could not read due requests: ${err.message}`);
    return result;
  }
  result.due = due.length;
  for (const lead of due) {
    try {
      const out = await dispatchNextWave(lead, options);
      if (out.wave) result.advanced += 1;
    } catch (err) {
      console.error(`[dispatch] wave sweep, lead #${lead.id}: ${err.message}`);
    }
  }
  return result;
}

/** Every minute: a 30-minute window should not run 15 minutes late. */
const leadWavesJob = {
  name: 'lead-waves',
  shouldRun: () => String(process.env.LEAD_WAVES || '').trim().toLowerCase() !== 'off',
  run: () => runWaveSweep(),
};

module.exports = {
  dispatchLead,
  dispatchNextWave,
  dispatchLeadInBackground,
  runWaveSweep,
  leadWavesJob,
  alertDeskOnce,
  deskText,
  // Exposed for scripts/verify-pipeline.js and services/leadClaims.js.
  fairnessMultiplier,
  budgetLabel,
  templateParams,
  alertText,
  fallbackText,
  alertButtons,
  agentLink,
  communesLabel,
  mergeRankedAcrossCommunes,
  claimButtonId,
  passButtonId,
  MAX_AGENTS_PER_LEAD,
  WAVE_SIZES,
  WAVE_WINDOW_MS,
  MAX_CLAIMS,
};
