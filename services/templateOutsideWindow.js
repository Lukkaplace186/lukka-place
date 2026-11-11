/**
 * "Text inside the 24 h window, template outside it" for the alerts whose
 * templates were approved on 2026-11-11 (the gap analysis of 2026-11-09):
 * the session message reaches only someone who wrote to us in the last 24 h,
 * so for everyone else the approved template is the only thing that arrives.
 *
 * `sendTemplateOutsideWindow` sends the template named by an env var (read at
 * call time, unset = never) when the recipient is OUTSIDE their window, and
 * returns whether it went. The caller sends its usual session message when it
 * returns false — inside the window (the text reads better and can say more),
 * no template configured, or the template send failed. Never throws.
 *
 * A template approved with a picture header is listed in TEMPLATES_WITH_IMAGE
 * (chakra.sendTemplate adds the picture); variables are cleaned to one line
 * (Meta refuses a newline) and never empty (Meta refuses that too).
 */

const { insideSessionWindow } = require('./sessionWindow');

const PARAM_MAX = 200;

function cleanParam(value, fallback = '—') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > PARAM_MAX ? `${text.slice(0, PARAM_MAX - 1)}…` : text;
}

function firstName(name, fallback) {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first || fallback;
}

/**
 * @param {Object} p
 * @param {string} p.to          recipient digits
 * @param {string} p.envName     the env var naming the template
 * @param {Array}  p.bodyParams  {{1}}… in order
 * @param {Array<{id: string}>} [p.buttons]  quick-reply payloads, in the template's order
 * @param {string|number} [p.urlButton]      the dynamic link's variable part
 * @param {string} p.label       for the logs
 * @param {Date}   [p.now]
 * @returns {Promise<boolean>} whether the template was accepted for sending
 */
async function sendTemplateOutsideWindow({ to, envName, bodyParams, buttons, urlButton, label, now = new Date() }) {
  const name = String(process.env[envName] || '').trim();
  const digits = String(to || '').replace(/\D/g, '');
  if (!name || !digits) return false;
  try {
    if (insideSessionWindow(digits, now)) return false;
  } catch {
    // No window record readable: treat as outside, the template is the safe send.
  }
  try {
    // eslint-disable-next-line global-require
    await require('./chakra').sendTemplate(digits, name, {
      languageCode: String(process.env[`${envName}_LANG`] || 'fr'),
      bodyParams: (bodyParams || []).map((value) => cleanParam(value)),
      ...(Array.isArray(buttons) && buttons.length ? { buttons: buttons.map((b) => ({ id: b.id })) } : {}),
      ...(urlButton != null ? { urlButton: String(urlButton) } : {}),
    });
    console.log(`[template] ${label}: '${name}' sent to ${digits} (outside the 24 h window)`);
    return true;
  } catch (err) {
    console.warn(`[template] ${label}: '${name}' failed for ${digits} (${err.message}) — session message instead`);
    return false;
  }
}

module.exports = { sendTemplateOutsideWindow, cleanParam, firstName };
