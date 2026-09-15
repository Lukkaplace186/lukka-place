/**
 * What a customer's own viewing request looks like as a timeline, and what
 * they may do about it — derived from the engine's real `viewing_requests`
 * row (GET /admin/viewing-requests/by-customer), never from the lead status
 * alone, which could not tell a confirmed visit from an unanswered one.
 *
 * Pure and client-safe. The messages page runs it on the server with the
 * request's own `now`, so the browser renders exactly what the server did
 * rather than re-deciding "has the visit time passed?" a second later.
 *
 * The permissions mirror the engine's rules and must stay in step with them:
 *   canCancel      CUSTOMER_TRANSITIONS.CANCEL (services/viewingNotifications.js),
 *                  minus a confirmed visit whose time has already passed —
 *                  that one is reviewed, not cancelled.
 *   canAcceptSlot  CUSTOMER_TRANSITIONS.ACCEPT_SLOT (RESCHEDULED only).
 *   canCheckin     POST /viewing-requests/:id/checkin: CONFIRMED, time passed,
 *                  no answer yet.
 *   canGiveReason  after a 👎, until a reason is recorded.
 */

export const CANCELLABLE_VIEWING_STATUSES = ['PENDING', 'RESCHEDULED', 'CONFIRMED'];

export const VIEWING_FALLOFF_REASON_CODES = ['PRICE_TOO_HIGH', 'LOCATION_DESELECTED', 'TERMS_UNACCEPTABLE', 'OTHER'];

export const VIEWING_CHECKIN_RESPONSES = ['GOOD', 'BAD', 'AGENT_ABSENT'];

// Keys, not text — see components/navItems.js.
export const VIEWING_STATUS_LABEL_KEYS = {
  PENDING: 'account.visits.status.PENDING',
  CONFIRMED: 'account.visits.status.CONFIRMED',
  RESCHEDULED: 'account.visits.status.RESCHEDULED',
  DECLINED: 'account.visits.status.DECLINED',
  CANCELLED: 'account.visits.status.CANCELLED',
  COMPLETED: 'account.visits.status.COMPLETED',
};

export const VIEWING_STATUS_TONES = {
  PENDING: 'warning',
  CONFIRMED: 'royal',
  RESCHEDULED: 'warning',
  DECLINED: 'neutral',
  CANCELLED: 'neutral',
  COMPLETED: 'success',
};

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {Object|null} viewing a customer-safe viewing_requests row
 * @param {Date} [now]
 * @returns {null|{status: string, steps: Array<{key: string, state: 'done'|'current'|'upcoming'|'stopped'}>,
 *   canCancel: boolean, canAcceptSlot: boolean, canCheckin: boolean, canGiveReason: boolean, visitPassed: boolean}}
 */
export function viewingTimeline(viewing, now = new Date()) {
  if (!viewing) return null;
  const { status } = viewing;
  const scheduled = validDate(viewing.scheduled_at);
  const visitPassed = Boolean(scheduled && scheduled.getTime() <= now.getTime());

  const steps = [{ key: 'requested', state: 'done' }];

  if (status === 'PENDING') {
    steps.push({ key: viewing.sla_alerted_at ? 'awaitingAgentAlternatives' : 'awaitingAgent', state: 'current' });
  } else if (status === 'RESCHEDULED') {
    steps.push({ key: 'newSlot', state: 'current' });
  } else if (status === 'DECLINED') {
    steps.push({ key: 'declined', state: 'stopped' });
  } else if (status === 'CANCELLED') {
    const key = { CUSTOMER: 'cancelledByYou', AGENT: 'cancelledByAgent' }[viewing.cancelled_by] || 'cancelled';
    steps.push({ key, state: 'stopped' });
  } else {
    steps.push({ key: 'confirmed', state: 'done' });
  }

  const terminal = status === 'DECLINED' || status === 'CANCELLED';
  if (!terminal) {
    const agentAbsent = viewing.checkin_response === 'AGENT_ABSENT';
    const visitDone = status === 'COMPLETED' || (status === 'CONFIRMED' && visitPassed);
    if (agentAbsent) {
      steps.push({ key: 'agentAbsent', state: 'stopped' });
    } else {
      steps.push({ key: 'visit', state: visitDone ? 'done' : status === 'CONFIRMED' ? 'current' : 'upcoming' });
    }
    const feedbackGiven = Boolean(viewing.checkin_response);
    steps.push({
      key: feedbackGiven ? 'feedbackGiven' : 'feedback',
      state: feedbackGiven ? 'done' : visitDone ? 'current' : 'upcoming',
    });
  }

  return {
    status,
    steps,
    canCancel: CANCELLABLE_VIEWING_STATUSES.includes(status) && !(status === 'CONFIRMED' && visitPassed),
    canAcceptSlot: status === 'RESCHEDULED',
    canCheckin: status === 'CONFIRMED' && visitPassed && !viewing.checkin_response,
    canGiveReason: viewing.checkin_response === 'BAD' && !viewing.customer_reason_code,
    visitPassed,
  };
}
