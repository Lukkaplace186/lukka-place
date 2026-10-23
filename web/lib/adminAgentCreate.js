import { normalizePhone } from './phone';

/**
 * "Créer un agent" / "Vérifier le numéro" from the console — the pure half.
 *
 * Both actions make a number a verified agent with no code from that phone:
 * the team vouches for it (brokers whose listings arrive from WhatsApp
 * groups, agents met in person). The engine does the writes
 * (services/adminAgentAccounts.js: the WhatsApp onboarding's own
 * upsertAgentFromWhatsApp, then the listing claim); this file reads the form
 * and words the answers. Server actions: app/admin/agents/createAgentActions.js.
 */

/** Lukka Place's own WhatsApp numbers: intake and notifications. Never an agent. */
export const BUSINESS_NUMBERS = ['243976321848', '243846962654'];

/** The engine's refusal codes → the console's i18n keys. */
export const ADMIN_AGENT_ERROR_KEYS = {
  'phone-invalid': 'admin.agentCreate.errorPhone',
  'phone-ours': 'admin.agentCreate.errorOurs',
  'name-required': 'admin.agentCreate.errorName',
  'phone-taken': 'admin.agentCreate.errorTaken',
  'phone-verified-elsewhere': 'admin.agentCreate.errorVerifiedElsewhere',
  'not-found': 'errors.agentNotFound',
  'postgres-unavailable': 'admin.agentCreate.errorUnavailable',
};

/**
 * Reads the create form. The phone goes through lib/phone.js with the country
 * PhoneField posts (7–15 digits); communes are kept only when they are in
 * `validCommunes`, the list the action re-reads itself.
 *
 * @param {FormData} formData
 * @param {string[]} validCommunes
 * @returns {{ok: true, values: object} | {ok: false, errorKey: string}}
 */
export function parseAdminAgentForm(formData, validCommunes = []) {
  const firstName = String(formData.get('first_name') || '').trim().slice(0, 80);
  const lastName = String(formData.get('last_name') || '').trim().slice(0, 80);
  const agencyName = String(formData.get('agency_name') || '').trim().slice(0, 160);
  if (!firstName) return { ok: false, errorKey: ADMIN_AGENT_ERROR_KEYS['name-required'] };

  const phone = normalizePhone(String(formData.get('phone') || ''), String(formData.get('phoneCountry') || ''));
  if (!phone || !/^\d{7,15}$/.test(phone)) return { ok: false, errorKey: ADMIN_AGENT_ERROR_KEYS['phone-invalid'] };
  if (BUSINESS_NUMBERS.includes(phone)) return { ok: false, errorKey: ADMIN_AGENT_ERROR_KEYS['phone-ours'] };

  const valid = new Set(validCommunes);
  const primaryCommunes = [...new Set(formData.getAll('primary_communes').map(String))].filter((c) => valid.has(c));

  return {
    ok: true,
    values: { phone, firstName, lastName: lastName || null, agencyName: agencyName || null, primaryCommunes },
  };
}

/**
 * The text an admin sends the agent from their OWN WhatsApp (nothing is sent
 * automatically). The link sets the first password; the account already
 * works for listings, so it is a convenience, not a gate.
 */
export function activationShareText({ firstName, link }) {
  return [
    `Bonjour${firstName ? ` ${firstName}` : ''}, votre compte agent Lukka Place est prêt.`,
    'Vos annonces sont maintenant liées à votre compte.',
    '',
    'Choisissez votre mot de passe ici (lien personnel, à usage unique) :',
    link,
  ].join('\n');
}

/** A wa.me link to the agent with that text typed in, or null for an unusable number. */
export function activationShareHref({ phone, firstName, link }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits) || !link) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(activationShareText({ firstName, link }))}`;
}

/** The note left on the agent's timeline, naming who vouched (the audit log has it too). */
export function adminVerificationNote({ created, actor }) {
  return created
    ? `Compte créé depuis la console par ${actor}, numéro vérifié sans code WhatsApp (vérification par l’équipe).`
    : `Numéro vérifié depuis la console par ${actor}, sans code WhatsApp (vérification par l’équipe).`;
}
