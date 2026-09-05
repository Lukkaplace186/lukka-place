import 'server-only';
import { getCustomerById, getCurrentCustomerId } from './customers';
import { listLeads, getLeadProposals } from './adminApi';
import { getListingsByIds } from './listings';

/**
 * A customer's own submitted inquiries — /compte/demandes. Leads live in the
 * engine's SQLite, reached only through lib/adminApi.js's server-only
 * client; scoped here by the authenticated customer's own phone, which is
 * already stored in the same digits-only wa_id shape a lead's `wa_id`
 * column holds (confirmed: lib/resetPassword.js's customer adapter already
 * sends WhatsApp OTPs to `customer.phone` through the engine's
 * digits-only-validated send-whatsapp route).
 *
 * `customerId` must come from the caller's own authenticated session — see
 * getCurrentCustomerInquiries() below, the only entry point pages should
 * use. Never resolve a customer id from a client-supplied value; that
 * would let one customer read another's inquiry history.
 *
 * The engine being unreachable must not take /compte or /compte/demandes
 * down — same non-throwing-fallback principle as
 * lib/locations.js's getLocationHierarchySafe() (see its doc comment: this
 * page's own data is fine, only the lead history is engine-dependent, so
 * losing it should degrade to an empty list, not a 500).
 *
 * @param {number} customerId
 * @returns {Promise<Array<{lead: Object, listing: Object|null, proposals: Object[]}>>}
 *   `proposals` is the real listing rows agents have pitched against this
 *   lead in response to their request (web/lib/adminApi.js's
 *   getLeadProposals) — [] until at least one agent proposes something.
 */
export async function getCustomerInquiries(customerId) {
  const customer = await getCustomerById(customerId);
  if (!customer) return [];

  let leads;
  try {
    ({ data: leads } = await listLeads({ waId: customer.phone, limit: 100 }));
  } catch (error) {
    console.warn('[customerInquiries] engine unreachable, falling back to an empty list:', error.message);
    return [];
  }
  if (leads.length === 0) return [];

  // Agent proposals for this customer's own leads — best-effort,
  // same non-throwing posture as the leads fetch above: a proposals lookup
  // failure should degrade to "no proposals shown yet", not break the whole
  // page.
  let proposals = [];
  try {
    ({ proposals } = await getLeadProposals(leads.map((lead) => lead.id)));
  } catch (error) {
    console.warn('[customerInquiries] proposals unreachable, showing none:', error.message);
  }

  const propertyIds = [
    ...leads.map((lead) => lead.property_id),
    ...proposals.map((p) => p.property_id),
  ].filter((id) => id != null);
  const listings = propertyIds.length > 0 ? await getListingsByIds(propertyIds) : [];
  // Keyed by String(id): properties.id is a Postgres bigint, which
  // node-postgres returns as a string, while lead.property_id/
  // proposal.property_id come from the engine's SQLite as plain numbers —
  // a Map lookup with the raw number silently never matched (caught live:
  // every proposal came back filtered out as "no listing found" despite the
  // row genuinely existing). Same bug class as the agent-side
  // Number(l.id) fix in web/app/compte/agent/actions.js's proposeListingAction.
  const listingById = new Map(listings.map((listing) => [String(listing.id), listing]));

  const proposalsByLeadId = new Map();
  for (const proposal of proposals) {
    const list = proposalsByLeadId.get(proposal.lead_id) || [];
    list.push(proposal);
    proposalsByLeadId.set(proposal.lead_id, list);
  }

  // A listing that's since been unpublished/rejected simply has no match
  // here — honest absence, never a fabricated placeholder (web/CLAUDE.md).
  return leads.map((lead) => ({
    lead,
    listing: lead.property_id != null ? listingById.get(String(lead.property_id)) || null : null,
    proposals: (proposalsByLeadId.get(lead.id) || [])
      .map((p) => listingById.get(String(p.property_id)))
      .filter(Boolean),
  }));
}

/** Resolves the current session itself — the one entry point /compte/demandes should use. */
export async function getCurrentCustomerInquiries() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return [];
  return getCustomerInquiries(customerId);
}
