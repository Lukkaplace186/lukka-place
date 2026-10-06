import { toTime } from './visitAgenda';

/**
 * Pure rules behind the Espace Client redesign (2026-10-05, prototype
 * web/Design/client-portal-prototype.html). Accueil is an inbox: everything on
 * it is something the customer can act on, so what counts as "waiting on the
 * customer" is decided here, once, and pinned by
 * tests/unit/client-portal-redesign.test.js.
 */

/**
 * The three entry costs a listing STATES, each on its own — never summed into
 * a "Garantie" (that is the bug the engine's 3 + 1 + 1 split undid). Unlike
 * entryTerms()' positional notation, a stated commission is shown even when
 * the advance is not: these are labelled separately, so nothing is implied
 * about the missing one. NULL ("not stated") is left out; 0 ("none") is kept.
 * A sale has no entry costs.
 *
 * @returns {{key: 'deposit'|'advance'|'commission', months: number}[]}
 */
export function entryCostParts(listing) {
  if (!listing || listing.purpose === 'sale' || listing.purpose === 'vente') return [];
  const parts = [];
  for (const [key, column] of [['deposit', 'deposit_months'], ['advance', 'advance_months'], ['commission', 'commission_months']]) {
    const raw = listing[column];
    if (raw === null || raw === undefined || raw === '') continue;
    const months = Number(raw);
    if (Number.isFinite(months) && months >= 0) parts.push({ key, months });
  }
  return parts;
}

const MONTHS_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const KINSHASA_OFFSET_MS = 3600 * 1000;

/**
 * The instant an agent's proposal names, read from the phrase itself — only
 * the engine's own formatSlotFr shape ("mercredi 30 septembre à 09h30", which
 * is what the dashboard and the WhatsApp buttons write), never free text. The
 * phrase carries no year: the nearest one is taken (a date more than half a
 * year behind is next year's). Null when the phrase is anything else.
 *
 * Not `scheduled_at`: on a RESCHEDULED row that can still hold the slot the
 * proposal replaced (seen in production: proposal "30 septembre", stored
 * instant 23 September).
 */
export function proposedSlotAt(phrase, now = new Date()) {
  const folded = String(phrase || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = folded.match(/(\d{1,2})(?:er)?\s+([a-z]+)\s+a\s+(\d{1,2})\s*h\s*(\d{2})?/);
  if (!m) return null;
  const month = MONTHS_FR.indexOf(m[2]);
  const day = Number(m[1]);
  const hour = Number(m[3]);
  const minute = Number(m[4] || 0);
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  let year = new Date(now.getTime() + KINSHASA_OFFSET_MS).getUTCFullYear();
  const at = (y) => Date.UTC(y, month, day, hour, minute) - KINSHASA_OFFSET_MS;
  if (at(year) < now.getTime() - 183 * 24 * 3600 * 1000) year += 1;
  // "31 septembre" rolls into October in Date.UTC; that is not a date.
  if (new Date(Date.UTC(year, month, day)).getUTCMonth() !== month) return null;
  return new Date(at(year));
}

/** An agent's proposal whose time has already gone by — nothing to accept. */
export function proposalExpired(visit, now = new Date()) {
  if (visit?.status !== 'RESCHEDULED') return false;
  const at = proposedSlotAt(visit.requestedTime, now);
  return Boolean(at && at.getTime() <= now.getTime());
}

/**
 * A visit the agent moved to another slot that is still ahead: only the
 * customer can answer it. An expired proposal is not "awaiting" anybody — the
 * card says so and offers WhatsApp instead of an Accept that would pin a past
 * time.
 */
export function isAwaitingCustomer(visit, now = new Date()) {
  return visit?.status === 'RESCHEDULED' && !proposalExpired(visit, now);
}

/**
 * A confirmed visit whose time has passed and that the customer has not rated
 * — the same rule as viewingTimeline's canCheckin, from the agenda item.
 */
export function needsCheckin(visit, now = new Date()) {
  const at = toTime(visit?.at);
  return visit?.status === 'CONFIRMED' && Boolean(visit.agreed) && at != null && at <= now.getTime() && !visit.checkinResponse;
}

/**
 * Accueil's inbox from groupCustomerVisits' groups:
 *   answer   agent-proposed slots, oldest request first as the agenda lists them
 *   checkin  visits to rate (at most the two most recent)
 *   next     the next confirmed visit still ahead, or null
 */
export function homeVisitInbox(groups, now = new Date()) {
  const all = [...groups.today, ...groups.tomorrow, ...groups.upcoming, ...groups.unscheduled, ...groups.past];
  const answer = all.filter((v) => isAwaitingCustomer(v, now));
  const checkin = [...groups.today, ...groups.past].filter((v) => needsCheckin(v, now)).slice(0, 2);
  const next = [...groups.today, ...groups.tomorrow, ...groups.upcoming]
    .find((v) => v.status === 'CONFIRMED' && v.agreed && (toTime(v.at) ?? 0) > now.getTime()) || null;
  return { answer, checkin, next };
}

/**
 * Leads that are not a search for a property: a developer applying to list,
 * an enquiry about one project or one listing, a visit request. They stay on
 * Demandes; they are not "where your search stands".
 */
export const NON_SEARCH_LEAD_SOURCES = ['developer-application', 'project-enquiry', 'listing-visit-request', 'listing-whatsapp-enquiry'];

/**
 * The customer's own "Trouver pour moi" requests (no listing behind them, no
 * visit), newest first, as Accueil's status rows. A visit request is a visit,
 * not a request — it is on Visites.
 */
export function requestRows(inquiries = [], limit = 3) {
  return inquiries
    .filter(({ lead, listing, viewings = [] }) => lead
      && lead.property_id == null && !listing && viewings.length === 0
      && !NON_SEARCH_LEAD_SOURCES.includes(lead.source))
    .slice(0, limit)
    .map(({ lead, proposals = [] }) => ({
      id: lead.id,
      summary: lead.requirements_summary || null,
      proposals: proposals.length,
      createdAt: lead.created_at || null,
    }));
}

/**
 * New listings across every saved search, each once, newest first — the
 * Accueil rail. Reads getSavedSearchMatches' result and never stamps
 * last_viewed_at (only the Alertes tab does), so opening Accueil cannot
 * zero the counts Alertes is about to show.
 */
export function freshAlertListings(matches = [], limit = 10) {
  const seen = new Set();
  const out = [];
  for (const { newListings = [] } of matches) {
    for (const listing of newListings) {
      const id = String(listing.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(listing);
    }
  }
  out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return { listings: out.slice(0, limit), total: out.length };
}

/** "Grace" from "Grace Ilunga"; null when the account has no name. */
export function firstName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first || null;
}
