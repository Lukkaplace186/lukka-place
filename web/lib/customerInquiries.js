import 'server-only';
import { getCustomerById, getCurrentCustomerId } from './customers';
import { listLeads } from './adminApi';
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
 * @returns {Promise<Array<{lead: Object, listing: Object|null}>>}
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

  const propertyIds = leads.map((lead) => lead.property_id).filter((id) => id != null);
  const listings = propertyIds.length > 0 ? await getListingsByIds(propertyIds) : [];
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));

  // A listing that's since been unpublished/rejected simply has no match
  // here — honest absence, never a fabricated placeholder (web/CLAUDE.md).
  return leads.map((lead) => ({
    lead,
    listing: lead.property_id != null ? listingById.get(lead.property_id) || null : null,
  }));
}

/** Resolves the current session itself — the one entry point /compte/demandes should use. */
export async function getCurrentCustomerInquiries() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return [];
  return getCustomerInquiries(customerId);
}
