/**
 * The agent's Demandes inbox as ONE list (2026-10-06, product direction: the
 * "Mes demandes" / "Visites" split made the agent check two lists for the
 * same customer). Pure — the page reads the engine and passes the rows in.
 *
 * ONE ROW PER REQUEST, the rule lib/agentTodo.js already uses: a web visit
 * request writes a `leads` row AND a `viewing_requests` row for the same ask,
 * so the lead is folded into its visit when the visit carries its id
 * (`lead_id`), or comes from the same number for the same listing while the
 * lead is still NEW / VIEWING_REQUESTED. A customer with two different
 * requests still gets two rows.
 *
 * Order: what waits on the agent first (visits to confirm, new enquiries),
 * then confirmed visits (soonest first), then everything already handled —
 * newest first inside each group. Filters are the same three groups.
 */

export const INBOX_FILTERS = Object.freeze(['a-traiter', 'confirmees', 'traitees']);

const WAITING_VISIT = new Set(['PENDING', 'RESCHEDULED']);
const FOLDABLE_LEAD = new Set(['NEW', 'VIEWING_REQUESTED']);

const digits = (value) => String(value || '').replace(/\D/g, '');

/** Engine timestamps are SQLite `YYYY-MM-DD HH:MM:SS` in UTC. */
export function engineTime(value) {
  if (!value) return 0;
  const iso = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? 0 : time;
}

/** 'a-traiter' | 'confirmees' | 'traitees' for one inbox item. */
export function inboxGroup(item) {
  if (item.kind === 'visit') {
    if (WAITING_VISIT.has(item.row.status)) return 'a-traiter';
    if (item.row.status === 'CONFIRMED') return 'confirmees';
    return 'traitees';
  }
  return item.row.status === 'NEW' ? 'a-traiter' : 'traitees';
}

const GROUP_RANK = { 'a-traiter': 0, confirmees: 1, traitees: 2 };

function searchText(item, titleFor) {
  const row = item.row;
  const propertyId = item.kind === 'visit' ? row.property_id || row.lead_property_id : row.property_id;
  return [
    item.kind === 'visit' ? row.lead_name : row.name,
    item.kind === 'visit' ? row.lead_wa_id : row.wa_id,
    row.requirements_summary,
    row.requested_time,
    propertyId ? titleFor(propertyId) : null,
  ].filter(Boolean).join(' ').toLowerCase();
}

/**
 * @param {{visits?: object[], leads?: object[], filter?: string, q?: string,
 *          focusLeadId?: number, titleFor?: (propertyId) => string|null}} input
 * @returns {{items: Array<{kind: 'visit'|'lead', key: string, row: object, group: string, focused: boolean}>,
 *            counts: {all: number, 'a-traiter': number, confirmees: number, traitees: number},
 *            focusFound: boolean}}
 */
export function buildAgentInbox({ visits = [], leads = [], filter = '', q = '', focusLeadId = null, titleFor = () => null } = {}) {
  const visitRows = (visits || []).filter((v) => v && v.id != null);
  const visitLeadIds = new Set(visitRows.map((v) => String(v.lead_id ?? '')).filter(Boolean));
  const visitAsks = new Set(visitRows.map((v) => `${digits(v.lead_wa_id)}|${v.property_id || v.lead_property_id || ''}`));

  const leadRows = (leads || []).filter((l) => l && l.id != null).filter((l) => {
    if (visitLeadIds.has(String(l.id))) return false;
    const ask = `${digits(l.wa_id)}|${l.property_id || ''}`;
    return !(FOLDABLE_LEAD.has(l.status) && digits(l.wa_id) && l.property_id && visitAsks.has(ask));
  });

  const focus = Number.isFinite(focusLeadId) ? String(focusLeadId) : null;
  let all = [
    ...visitRows.map((row) => ({ kind: 'visit', key: `v-${row.id}`, row, focused: focus != null && String(row.lead_id ?? '') === focus })),
    ...leadRows.map((row) => ({ kind: 'lead', key: `l-${row.id}`, row, focused: focus != null && String(row.id) === focus })),
  ].map((item) => ({ ...item, group: inboxGroup(item) }));

  const needle = String(q || '').trim().toLowerCase();
  if (needle) all = all.filter((item) => searchText(item, titleFor).includes(needle));

  const counts = { all: all.length, 'a-traiter': 0, confirmees: 0, traitees: 0 };
  for (const item of all) counts[item.group] += 1;

  const active = INBOX_FILTERS.includes(filter) ? filter : '';
  const items = (active ? all.filter((item) => item.group === active) : all).sort((a, b) => {
    // The request the agent arrived from (a WhatsApp alert's deep link) first.
    if (a.focused !== b.focused) return a.focused ? -1 : 1;
    if (a.group !== b.group) return GROUP_RANK[a.group] - GROUP_RANK[b.group];
    if (a.group === 'confirmees') {
      const at = (item) => engineTime(item.row.scheduled_at) || Number.MAX_SAFE_INTEGER;
      if (at(a) !== at(b)) return at(a) - at(b);
    }
    return engineTime(b.row.created_at) - engineTime(a.row.created_at);
  });

  return { items, counts, focusFound: focus == null || all.some((item) => item.focused) };
}

/**
 * When the agent last opened Demandes (ms since epoch, server clock), as a
 * cookie on this device: there is no read-state column, and the badge is
 * about "anything new since I last looked", not about answering.
 */
export const INBOX_SEEN_COOKIE = 'lp_inbox_seen';

/** The stamp the Demandes page hands InboxSeenMarker: the server's clock, now. */
export function inboxSeenStamp() {
  return Date.now();
}

/**
 * `waiting`: the "À traiter" count. `unseen`: those created after `seenAt`
 * (the badge). A missing or broken `seenAt` means never looked: all unseen.
 */
export function inboxBadgeCounts({ visits = [], leads = [], seenAt = null } = {}) {
  const { items } = buildAgentInbox({ visits, leads, filter: 'a-traiter' });
  const seen = Number(seenAt);
  const since = Number.isFinite(seen) && seen > 0 ? seen : 0;
  return { waiting: items.length, unseen: items.filter((item) => engineTime(item.row.created_at) > since).length };
}

/** Old links (`?tab=visites`, `?status=PENDING`) land on the matching filter. */
export function inboxFilterFromParams(params = {}) {
  if (INBOX_FILTERS.includes(params.filtre)) return params.filtre;
  if (params.status === 'PENDING' || params.status === 'RESCHEDULED' || params.status === 'NEW') return 'a-traiter';
  if (params.status === 'CONFIRMED') return 'confirmees';
  return '';
}
