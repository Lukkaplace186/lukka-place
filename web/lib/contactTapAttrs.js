/**
 * Data attributes that make a direct "WhatsApp" / "Appeler" link to an agent
 * report its tap (2026-11-15, /admin/contacts). Since WhatsApp goes straight
 * to the agent, the agent profile, the agents directory, a project page and
 * the Espace Client's visit and proposal cards opened the agent's WhatsApp
 * and left no trace at all. components/ContactTapBeacon.js listens for a click
 * on a link carrying these and posts it to /api/telemetry/contact-tap, which
 * works the agent out from the agent / listing / project named here.
 *
 * Listing buttons are NOT marked: they already report through
 * trackLeadClick / call_click (whatsapp_clicks, listing_events).
 *
 * Client-safe and pure. Returns {} when there is nothing to name, so it can be
 * spread on any link.
 */

export const CONTACT_TAP_SURFACES = ['profile', 'directory', 'project', 'client_visit', 'client_inquiry'];
export const CONTACT_TAP_CHANNELS = ['whatsapp', 'call'];

/**
 * @param {{surface: string, channel: 'whatsapp'|'call', agentId?: number|string|null,
 *   listingId?: number|string|null, projectSlug?: string|null}} tap
 * @returns {Object<string, string>}
 */
export function contactTapProps({ surface, channel, agentId = null, listingId = null, projectSlug = null }) {
  if (!CONTACT_TAP_SURFACES.includes(surface) || !CONTACT_TAP_CHANNELS.includes(channel)) return {};
  const props = { 'data-contact-tap': surface, 'data-contact-channel': channel };
  if (agentId != null && String(agentId) !== '') props['data-contact-agent'] = String(agentId);
  if (listingId != null && String(listingId) !== '') props['data-contact-listing'] = String(listingId);
  if (projectSlug) props['data-contact-project'] = String(projectSlug);
  return props['data-contact-agent'] || props['data-contact-listing'] || props['data-contact-project'] ? props : {};
}

/** The beacon's payload from a marked link's dataset; null when it names nothing. */
export function contactTapPayload(dataset) {
  if (!dataset) return null;
  const surface = dataset.contactTap;
  const channel = dataset.contactChannel;
  if (!CONTACT_TAP_SURFACES.includes(surface) || !CONTACT_TAP_CHANNELS.includes(channel)) return null;
  const payload = { surface, channel };
  if (dataset.contactAgent) payload.agentId = dataset.contactAgent;
  if (dataset.contactListing) payload.listingId = dataset.contactListing;
  if (dataset.contactProject) payload.projectSlug = dataset.contactProject;
  return payload.agentId || payload.listingId || payload.projectSlug ? payload : null;
}
