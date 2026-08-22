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
