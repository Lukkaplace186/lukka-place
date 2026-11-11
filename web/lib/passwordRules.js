/**
 * Minimum password lengths, one place (pure, safe in the browser).
 *
 * Customers: 6 (owner decision 2026-11-11). Typing eight characters on a
 * phone keyboard was a reason to give up, and a customer account guards
 * saved searches and favourites, not money or listings.
 *
 * Agents stay at 8: confirming an agent's number claims every listing sent
 * from it (lib/agentAuth.js consumeAgentOtp), so the account is worth more.
 * Console accounts have their own, stricter rule (lib/adminUsers.js).
 */
export const CUSTOMER_PASSWORD_MIN = 6;
export const AGENT_PASSWORD_MIN = 8;

/** @param {'customer'|'agent'} role */
export function passwordMinFor(role) {
  return role === 'agent' ? AGENT_PASSWORD_MIN : CUSTOMER_PASSWORD_MIN;
}

/** @param {'customer'|'agent'} role */
export function passwordLongEnough(password, role) {
  return String(password || '').length >= passwordMinFor(role);
}
