/**
 * /admin/interactions — how many times customers reached an agent, as one
 * number and per agent. Pure: lib/agentInteractions.js reads the rows, this
 * adds them up, so tests/unit/interaction-counts.test.js can pin the rules.
 *
 * Two stores hold the facts, and neither alone is the answer:
 *   - Postgres: the storefront taps (`whatsapp_clicks`, `listing_events`
 *     call_click), each already carrying the listing's agent;
 *   - the engine's SQLite (GET /admin/interaction-counts): enquiries sent to
 *     our WhatsApp from a listing, profile and project requests, visit
 *     requests, and the desk's "mises en relation" (engine
 *     services/teamIntroduction.js). A row that names only a listing is
 *     attributed to that listing's agent here.
 *
 * What is in the total: every channel that puts a customer in front of ONE
 * agent. A tap that went to Lukka Place's central number is not: when it
 * turned into a message, that message is already counted as an enquiry, so
 * counting the tap too would count one customer twice. Central taps are
 * reported beside the total. "Trouver pour moi" searches are pushed to
 * several agencies and are on /admin/matching, not here.
 *
 * A tap proves the button was pressed, not that a conversation followed —
 * the page says so. Only visitors' taps are counted (never the listing's own
 * agent, the team or a bot: lib/trackIngest.js's viewer_kind).
 */

/** In the order the page shows them; every one adds to the total. */
export const INTERACTION_CHANNELS = [
  { key: 'whatsappDirect', total: true },
  { key: 'callDirect', total: true },
  { key: 'whatsappEnquiry', total: true },
  { key: 'visitRequest', total: true },
  { key: 'profileEnquiry', total: true },
  { key: 'projectEnquiry', total: true },
  { key: 'teamIntroduction', total: true },
];

export const TOTAL_CHANNELS = INTERACTION_CHANNELS.filter((c) => c.total).map((c) => c.key);

/** Engine lead source → channel. */
export const LEAD_SOURCE_CHANNEL = {
  'listing-whatsapp-enquiry': 'whatsappEnquiry',
  'agent-profile-inquiry': 'profileEnquiry',
  'project-enquiry': 'projectEnquiry',
  'team-introduction': 'teamIntroduction',
};

export const INTERACTION_WINDOWS = [7, 30, 90];

/** @returns {number} one of INTERACTION_WINDOWS, 30 by default. */
export function interactionWindow(raw) {
  const days = Number.parseInt(raw, 10);
  return INTERACTION_WINDOWS.includes(days) ? days : 30;
}

function emptyChannels() {
  return Object.fromEntries(TOTAL_CHANNELS.map((key) => [key, 0]));
}

function toId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {{
 *   taps?: {agentId: number|null, routingType: string, count: number}[],
 *   calls?: {agentId: number|null, routingType: string, count: number}[],
 *   engine?: {leads?: {source: string, agentId: number|null, propertyId: number|null, count: number, contacted?: number}[],
 *             viewings?: {agentId: number|null, propertyId: number|null, count: number, contacted?: number}[]},
 *   propertyAgents?: Map<number, number|null>,
 * }} input
 * @returns {{total: number, channels: Record<string, number>, central: {whatsapp: number, call: number},
 *            contacted: number, answerable: number,
 *            agents: {agentId: number|null, channels: Record<string, number>, total: number, contacted: number, answerable: number}[]}}
 */
export function mergeInteractionCounts({ taps = [], calls = [], engine = {}, propertyAgents = new Map() } = {}) {
  const byAgent = new Map();
  const channels = emptyChannels();
  const central = { whatsapp: 0, call: 0 };
  let contacted = 0;
  let answerable = 0;

  const row = (agentId) => {
    const key = agentId ?? null;
    if (!byAgent.has(key)) byAgent.set(key, { agentId: key, channels: emptyChannels(), total: 0, contacted: 0, answerable: 0 });
    return byAgent.get(key);
  };
  const add = (agentId, channel, count, answered = null) => {
    const n = Number(count) || 0;
    if (n <= 0) return;
    const r = row(agentId);
    r.channels[channel] += n;
    r.total += n;
    channels[channel] += n;
    // Only rows that can be answered on our side (a request, not a tap) carry
    // a "the agent responded" figure.
    if (answered !== null) {
      r.contacted += Number(answered) || 0;
      r.answerable += n;
      contacted += Number(answered) || 0;
      answerable += n;
    }
  };
  const agentFor = (r) => toId(r.agentId) ?? toId(propertyAgents.get(toId(r.propertyId))) ?? null;

  for (const t of taps) {
    if (t.routingType === 'DIRECT_WA') add(toId(t.agentId), 'whatsappDirect', t.count);
    else central.whatsapp += Number(t.count) || 0;
  }
  for (const c of calls) {
    if (c.routingType === 'DIRECT') add(toId(c.agentId), 'callDirect', c.count);
    else central.call += Number(c.count) || 0;
  }
  for (const l of engine.leads || []) {
    const channel = LEAD_SOURCE_CHANNEL[l.source];
    if (channel) add(agentFor(l), channel, l.count, l.contacted ?? 0);
  }
  for (const v of engine.viewings || []) add(agentFor(v), 'visitRequest', v.count, v.contacted ?? 0);

  const agents = [...byAgent.values()].sort((a, b) => b.total - a.total || (a.agentId ?? Infinity) - (b.agentId ?? Infinity));
  const total = Object.values(channels).reduce((s, n) => s + n, 0);
  return { total, channels, central, contacted, answerable, agents };
}

/** Every listing id the engine rows name without an agent: what to look up in Postgres. */
export function propertyIdsToAttribute(engine = {}) {
  const ids = new Set();
  for (const r of [...(engine.leads || []), ...(engine.viewings || [])]) {
    if (!toId(r.agentId) && toId(r.propertyId)) ids.add(toId(r.propertyId));
  }
  return [...ids];
}

/** How the desk put a customer in touch — the engine's teamIntroduction.CHANNELS. */
export const INTRODUCTION_CHANNELS = ['phone', 'whatsapp', 'in_person', 'other'];
