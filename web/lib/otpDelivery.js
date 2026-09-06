import 'server-only';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from './adminApi';

/**
 * The one way a verification code leaves this app: WhatsApp, to the number
 * the account is registered under. There is no email channel anywhere in
 * this product — phone is the primary identifier (web/CLAUDE.md), and a code
 * sent to an address nobody proved they hold would verify nothing.
 *
 * **Template first, free-form second, and both are real.** Meta only
 * delivers a free-form (session) message to someone who has messaged this
 * business number in the last 24 hours. A first-time signup never has: the
 * free-form send is accepted with a real message id and then silently never
 * arrives — that exact failure was confirmed against the live account and is
 * why lib/agents.js's sendAgentOtp moved to a template. An approved
 * AUTHENTICATION template is not subject to that window.
 *
 * The fallback exists because the template lives in Meta's WhatsApp Manager,
 * not in this repo, and can be missing or pending approval (the engine's
 * CLAUDE.md documents exactly that state for AGENT_LEAD_MATCH_TEMPLATE:
 * `(#132001) Template name does not exist in the translation`). When the
 * template send fails, a session message still reaches everyone who has
 * messaged us recently — which is most agents and every customer coming from
 * the WhatsApp assistant. Both paths failing is reported as a real failure
 * to the caller, never swallowed.
 *
 * Template name/language are env-driven for the same reason: an approval in
 * Meta's console must not require a code change here.
 * OTP_TEMPLATE_HAS_BUTTON exists because Meta rejects an
 * AUTHENTICATION-category template sent without its copy-code button and
 * equally rejects a button component on a template that declares none — only
 * whoever approved it knows which shape it is.
 */

function templateConfig() {
  return {
    template: process.env.AGENT_OTP_TEMPLATE || 'agent_auth_otp',
    languageCode: process.env.AGENT_OTP_TEMPLATE_LANG || 'fr',
    withButton: process.env.AGENT_OTP_TEMPLATE_HAS_BUTTON !== '0',
  };
}

/**
 * @param {string} phone digits-only wa_id
 * @param {string} code the 6-digit code
 * @param {{fallbackText?: string, label?: string}} [options]
 *   `fallbackText` is the free-form message body; omit it to skip the
 *   fallback entirely. `label` only tags the log line.
 * @throws when neither channel delivered
 */
export async function sendOtpViaWhatsApp(phone, code, { fallbackText, label = 'otp' } = {}) {
  const { template, languageCode, withButton } = templateConfig();

  try {
    await sendWhatsAppTemplate(phone, {
      template,
      languageCode,
      bodyParams: [code],
      otpCode: withButton ? code : undefined,
    });
    return { channel: 'template' };
  } catch (templateError) {
    if (!fallbackText) throw templateError;
    console.warn(`[${label}] template send failed for ${phone} (${templateError.message}) — trying a session message`);
    try {
      await sendWhatsAppMessage(phone, fallbackText);
      return { channel: 'session' };
    } catch {
      // Surface the template error, not the session one: the template is
      // the channel that is supposed to work for a first-time recipient, so
      // its message is the one that tells an operator what to fix.
      throw templateError;
    }
  }
}

/**
 * The session-message body used when the template is unavailable. One
 * wording for every code this product sends, so a customer and an agent
 * receive the same message and neither reads as a different service.
 */
export function otpFallbackText(code) {
  return `Votre code de vérification Lukka Place : ${code} (valable 10 minutes). Ne le partagez avec personne.`;
}
