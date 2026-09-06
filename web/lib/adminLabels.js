/*
 * Shared status vocabularies for the conversationState.js states, LEAD_STATUSES
 * and the moderation queues — used by the admin console, the agent dashboard
 * and the customer portal alike.
 *
 * These now map each real database value to a DICTIONARY KEY rather than to
 * French text. The value side (`NEW`, `approve_status = 1`, …) is untouched:
 * it is what the database stores and what the queries filter on, and
 * translating it would change behaviour rather than presentation. Only the
 * label moved. The `_FR` suffix is gone from every export name with it — the
 * labels are no longer French-specific, so a name claiming they are would be
 * actively misleading.
 */

export const CONVERSATION_STATES = [
  'NEW', 'COLLECTING_REQUIREMENTS', 'SEARCHING_PROPERTIES', 'SHOWING_RESULTS',
  'PROPERTY_SELECTED', 'ANSWERING_PROPERTY_QUESTIONS', 'VIEWING_REQUEST',
  'CONTACT_REQUEST', 'HUMAN_HANDOFF', 'CLOSED',
];

export const CONVERSATION_STATE_LABEL_KEYS = Object.fromEntries(
  CONVERSATION_STATES.map((state) => [state, `status.conversation.${state}`]),
);

export const LEAD_STATUSES = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING_REQUESTED', 'VIEWING_COMPLETED', 'CONVERTED', 'LOST',
];

export const LEAD_STATUS_LABEL_KEYS = Object.fromEntries(
  LEAD_STATUSES.map((status) => [status, `status.lead.${status}`]),
);

export const VIEWING_REQUEST_STATUSES = ['PENDING', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'];

export const VIEWING_REQUEST_STATUS_LABEL_KEYS = Object.fromEntries(
  VIEWING_REQUEST_STATUSES.map((status) => [status, `status.viewingRequest.${status}`]),
);

/**
 * The moderation queues.
 *
 * The first three map 1:1 onto `properties.approve_status` (0/1/2). The
 * fourth, 'suspended', is a DIFFERENT column — `status = 0 AND
 * approve_status = 1`: content that passed moderation but is deliberately off
 * the site right now (an admin suspended it, or its agent archived it).
 *
 * That state was previously invisible everywhere in /admin: it matches none
 * of the three approve_status filters, so a suspended listing simply vanished
 * from the console with no way to find it again. Filtering by it goes through
 * getSuspendedListings (lib/adminListings.js) rather than the approve_status
 * WHERE map, which is exactly why it is called out here instead of being
 * quietly added to a list that means something else.
 */
export const LISTING_MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

export const LISTING_MODERATION_STATUS_LABEL_KEYS = Object.fromEntries(
  LISTING_MODERATION_STATUSES.map((status) => [status, `status.moderation.${status}`]),
);

/** agents.status / vendors.status — real smallint column, 0/1 only. */
export const AGENT_STATUS_LABEL_KEYS = {
  0: 'status.agentAccount.0',
  1: 'status.agentAccount.1',
};
