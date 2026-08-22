/**
 * services/conversationState.js
 *
 * The state machine backing every customer-search WhatsApp conversation
 * (see services/db.js's `conversations` table). The AI interprets natural
 * language, but the application — not the model — decides which state a
 * conversation is actually in; see root CLAUDE.md-equivalent principle
 * "AI ≠ database": the model proposes, this module (and its caller) decide.
 */

const STATES = Object.freeze({
  NEW: 'NEW',
  COLLECTING_REQUIREMENTS: 'COLLECTING_REQUIREMENTS',
  SEARCHING_PROPERTIES: 'SEARCHING_PROPERTIES',
  SHOWING_RESULTS: 'SHOWING_RESULTS',
  PROPERTY_SELECTED: 'PROPERTY_SELECTED',
  ANSWERING_PROPERTY_QUESTIONS: 'ANSWERING_PROPERTY_QUESTIONS',
  VIEWING_REQUEST: 'VIEWING_REQUEST',
  CONTACT_REQUEST: 'CONTACT_REQUEST',
  HUMAN_HANDOFF: 'HUMAN_HANDOFF',
  CLOSED: 'CLOSED',
});

/**
 * Allowed next states from each state. Every state can reach HUMAN_HANDOFF
 * and CLOSED directly ("je veux parler à quelqu'un" / "stop" — see product
 * spec §17/§47) without needing to unwind through the "normal" flow first.
 */
const TRANSITIONS = Object.freeze({
  [STATES.NEW]: [STATES.COLLECTING_REQUIREMENTS, STATES.HUMAN_HANDOFF, STATES.CLOSED],
  [STATES.COLLECTING_REQUIREMENTS]: [
    STATES.COLLECTING_REQUIREMENTS, STATES.SEARCHING_PROPERTIES, STATES.HUMAN_HANDOFF, STATES.CLOSED,
  ],
  [STATES.SEARCHING_PROPERTIES]: [STATES.SHOWING_RESULTS, STATES.HUMAN_HANDOFF, STATES.CLOSED],
  [STATES.SHOWING_RESULTS]: [
    STATES.SHOWING_RESULTS, STATES.PROPERTY_SELECTED, STATES.COLLECTING_REQUIREMENTS,
    STATES.SEARCHING_PROPERTIES, STATES.HUMAN_HANDOFF, STATES.CLOSED,
  ],
  [STATES.PROPERTY_SELECTED]: [
    STATES.ANSWERING_PROPERTY_QUESTIONS, STATES.VIEWING_REQUEST, STATES.CONTACT_REQUEST,
    STATES.SHOWING_RESULTS, STATES.HUMAN_HANDOFF, STATES.CLOSED,
  ],
  [STATES.ANSWERING_PROPERTY_QUESTIONS]: [
    STATES.ANSWERING_PROPERTY_QUESTIONS, STATES.VIEWING_REQUEST, STATES.CONTACT_REQUEST,
    STATES.SHOWING_RESULTS, STATES.HUMAN_HANDOFF, STATES.CLOSED,
  ],
  [STATES.VIEWING_REQUEST]: [STATES.HUMAN_HANDOFF, STATES.CLOSED],
  [STATES.CONTACT_REQUEST]: [STATES.HUMAN_HANDOFF, STATES.CLOSED],
  // "Return to AI" (admin dashboard, §19) re-enters requirement collection
  // rather than wherever the conversation left off — the agent may have
  // resolved something out of band the AI has no record of.
  [STATES.HUMAN_HANDOFF]: [STATES.COLLECTING_REQUIREMENTS, STATES.CLOSED],
  // "nouvelle recherche" (§47) reopens a closed conversation.
  [STATES.CLOSED]: [STATES.NEW],
});

function canTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

/** @throws {Error} if the transition isn't allowed. */
function assertTransition(from, to) {
  if (!STATES[to]) {
    throw new Error(`Unknown conversation state: ${to}`);
  }
  if (!canTransition(from, to)) {
    throw new Error(`Invalid conversation state transition: ${from} -> ${to}`);
  }
  return to;
}

module.exports = { STATES, TRANSITIONS, canTransition, assertTransition };
