import 'server-only';
import { getCustomerById } from './customers';
import { createLead } from './adminApi';
import {
  claimMoveProjectSend, getMoveProject, markMoveProjectSent, releaseMoveProjectSend,
} from './moveProjects';
import {
  MOVE_LEAD_SOURCE,
  MOVE_RESEND_AFTER_MS,
  moveCriteriaFr,
  moveRequestBlocker,
  moveStoryFr,
} from './moveProjectRules';

/**
 * A move project → a request to agencies (one `move-project` lead, which the
 * engine offers to the best-ranked agencies in waves of 2, 3 and 2 —
 * services/leadDispatch.js). One function for every way a project is sent:
 * the customer's "Envoyer ma demande aux agences", the automatic send when a
 * project is saved, and the console's "Envoyer aux agences".
 *
 * WHY THE AUTOMATIC SEND (owner, 2026-11-16: "it just disappears")
 * On production, 9 projects were saved and 0 ever reached an agency: the
 * request went only on an explicit tap, and was refused without a commune,
 * which 7 of 9 customers never ticked (they pick the city). The customer
 * answered the cards to be found a home; holding the request back helped
 * nobody. Now a project is sent as soon as it is saved, once — the first
 * time it has what agencies need (rent or buy, and a city or communes) — and
 * the cards say so before the account is created. The customer's number
 * still reaches an agency only when it takes the request (leadClaims, 3 at
 * most). `MOVE_AUTO_SEND=off` (read at call time) goes back to the tap only.
 */

/** @returns {boolean} whether a saved project is sent without a tap. */
export function moveAutoSendEnabled() {
  return String(process.env.MOVE_AUTO_SEND || '').trim().toLowerCase() !== 'off';
}

/**
 * Why this project cannot be sent now, or null.
 * 'inactive' (found or paused) · 'transaction' · 'communes' (no city either) ·
 * 'recent' (sent less than MOVE_RESEND_AFTER_MS ago) · 'phone' (no number).
 */
export function projectSendBlocker(project, customer, { now = Date.now() } = {}) {
  if (!project) return 'missing';
  if (!customer?.phone) return 'phone';
  if (project.status && project.status !== 'active') return 'inactive';
  const blocker = moveRequestBlocker(project);
  if (blocker) return blocker;
  if (project.lastLeadAt && now - new Date(project.lastLeadAt).getTime() < MOVE_RESEND_AFTER_MS) return 'recent';
  return null;
}

/** What the engine's POST /admin/leads gets for this project. Pure. */
export function moveLeadPayload(project, customer) {
  const story = moveStoryFr(project);
  const criteria = moveCriteriaFr(project);
  const communes = project.communes || [];
  return {
    waId: customer.phone,
    name: customer.full_name || null,
    source: MOVE_LEAD_SOURCE,
    // Story first: the agent's card shows three lines (AgentLeadCard).
    requirementsSummary: [story, criteria].filter(Boolean).join('\n') || null,
    transactionType: project.transactionType,
    commune: communes[0] || undefined,
    communes: communes.length ? communes : undefined,
    // No commune ticked: the agencies of the city are asked (engine leadDispatch cityWideOf).
    city: communes.length ? undefined : project.city || undefined,
    priceMin: project.budgetMin,
    priceMax: project.budgetMax,
    bedrooms: project.bedroomsMin,
    moveStory: story || undefined,
  };
}

/**
 * Send one of the customer's projects to agencies. Never throws.
 *
 * @param {number} customerId
 * @param {number} projectId
 * @param {{origin: 'customer'|'auto'|'admin', onlyIfNeverSent?: boolean}} options
 *   `onlyIfNeverSent`: the automatic send — a project already sent once is
 *   left to the customer's own "renvoyer" (an edit must not re-alert agencies).
 * @returns {Promise<{status: 'sent', leadId: number|null, phone: string}|{status: 'skipped'|'error', code: string}>}
 */
export async function sendMoveProjectRequest(customerId, projectId, { origin, onlyIfNeverSent = false } = {}) {
  try {
    const [customer, project] = await Promise.all([
      getCustomerById(customerId),
      projectId == null ? null : getMoveProject(customerId, projectId),
    ]);
    if (onlyIfNeverSent && project?.lastLeadId) return { status: 'skipped', code: 'already-sent' };
    const blocker = projectSendBlocker(project, customer);
    if (blocker) return { status: onlyIfNeverSent ? 'skipped' : 'error', code: blocker };

    // Reserved before the engine is called (one guarded UPDATE): a second
    // send while this one runs — a slow engine, then a tap — finds it taken.
    const slot = await claimMoveProjectSend(customerId, project.id, MOVE_RESEND_AFTER_MS);
    if (!slot.claimed) return { status: onlyIfNeverSent ? 'skipped' : 'error', code: 'recent' };
    let lead;
    try {
      ({ lead } = await createLead(moveLeadPayload(project, customer)));
    } catch (err) {
      await releaseMoveProjectSend(customerId, project.id, slot.previousAt);
      throw err;
    }
    const leadId = lead?.id ?? null;
    const where = project.communes?.length ? project.communes.join(',') : `${project.city || '?'} (city)`;
    console.log(`[move-project] ${origin}: lead #${leadId} from customer #${customerId} project #${project.id} ${project.transactionType} ${where}`);
    if (leadId) await markMoveProjectSent(customerId, project.id, leadId);
    return { status: 'sent', leadId, phone: customer.phone };
  } catch (err) {
    console.error(`[move-project] ${origin}: request for customer #${customerId} project #${projectId} failed: ${err.message}`);
    return { status: 'error', code: 'send' };
  }
}

/**
 * How long a save waits for the send. Sign-up and the cards await it, and
 * the engine call has no timeout of its own: an engine that hangs must not
 * hang a sign-up. Past this the save goes on; the send keeps running and
 * still records the request when it lands.
 */
export const AUTO_SEND_WAIT_MS = 5000;

/** The automatic send after a save (signup, login with answers, the cards). Never throws. */
export async function autoSendMoveProject(customerId, projectId, { waitMs = AUTO_SEND_WAIT_MS } = {}) {
  if (!moveAutoSendEnabled() || projectId == null) return { status: 'skipped', code: 'disabled' };
  const sending = sendMoveProjectRequest(customerId, projectId, { origin: 'auto', onlyIfNeverSent: true });
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: 'skipped', code: 'slow' }), waitMs);
  });
  const result = await Promise.race([sending, timeout]);
  clearTimeout(timer);
  if (result.code === 'slow') {
    console.warn(`[move-project] auto: project #${projectId} of customer #${customerId} still sending after ${waitMs} ms — not waited for`);
  } else if (result.status !== 'sent') {
    console.log(`[move-project] auto: project #${projectId} of customer #${customerId} not sent (${result.code})`);
  }
  return result;
}
