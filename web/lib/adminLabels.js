// Shared French labels for the conversationState.js states and LEAD_STATUSES
// values, used by both admin list/detail pages. Kept as plain data, not
// duplicated inline per page.

export const CONVERSATION_STATES = [
  'NEW', 'COLLECTING_REQUIREMENTS', 'SEARCHING_PROPERTIES', 'SHOWING_RESULTS',
  'PROPERTY_SELECTED', 'ANSWERING_PROPERTY_QUESTIONS', 'VIEWING_REQUEST',
  'CONTACT_REQUEST', 'HUMAN_HANDOFF', 'CLOSED',
];

export const CONVERSATION_STATE_LABELS_FR = {
  NEW: 'Nouveau',
  COLLECTING_REQUIREMENTS: 'Collecte des critères',
  SEARCHING_PROPERTIES: 'Recherche en cours',
  SHOWING_RESULTS: 'Résultats affichés',
  PROPERTY_SELECTED: 'Bien sélectionné',
  ANSWERING_PROPERTY_QUESTIONS: 'Questions sur le bien',
  VIEWING_REQUEST: 'Visite demandée',
  CONTACT_REQUEST: 'Contact demandé',
  HUMAN_HANDOFF: 'Transféré à un agent',
  CLOSED: 'Clôturé',
};

export const LEAD_STATUSES = [
  'NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING_REQUESTED', 'VIEWING_COMPLETED', 'CONVERTED', 'LOST',
];

export const LEAD_STATUS_LABELS_FR = {
  NEW: 'Nouveau',
  CONTACTED: 'Contacté',
  QUALIFIED: 'Qualifié',
  VIEWING_REQUESTED: 'Visite demandée',
  VIEWING_COMPLETED: 'Visite effectuée',
  CONVERTED: 'Converti',
  LOST: 'Perdu',
};

export const VIEWING_REQUEST_STATUSES = ['PENDING', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'];

export const VIEWING_REQUEST_STATUS_LABELS_FR = {
  PENDING: 'En attente',
  CONFIRMED: 'Confirmée',
  RESCHEDULED: 'Reprogrammée',
  CANCELLED: 'Annulée',
};

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

export const LISTING_MODERATION_STATUS_LABELS_FR = {
  pending: 'En attente',
  approved: 'Approuvé',
  rejected: 'Rejeté',
  suspended: 'Suspendu / archivé',
};

/** agents.status / vendors.status — real smallint column, 0/1 only. */
export const AGENT_STATUS_LABELS_FR = {
  0: 'Inactif',
  1: 'Actif',
};
