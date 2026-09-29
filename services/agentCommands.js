/**
 * WhatsApp commands for verified agents — `!mesbiens`, `!share 310`
 * (`!partager 310`), `!aide`.
 *
 * Deterministic and ahead of everything else in routes/webhook.js except the
 * button taps: only a message that STARTS with "!" and is under 40 characters
 * is a command, so a listing, a correction or an answer can never be read as
 * one, and a pending draft does not block it.
 *
 * The sender must be a VERIFIED agent (agentOnboarding.identifySender — the
 * same phone_verified_at gate as listing attribution). Anybody else gets one
 * short refusal. The reply itself is built by web (POST
 * /api/internal/agent-command, Bearer CRON_SECRET), so the caption is the
 * share kit's own and the listing is checked against the sender's agents.id
 * and the public rules there; the engine only relays. Web unreachable: an
 * honest "réessayez", never a caption the engine made up.
 */

const chakra = require('./chakra');
const { identifySender } = require('./agentOnboarding');

const MAX_COMMAND_LENGTH = 40;
const REQUEST_TIMEOUT_MS = 10000;

const ALIASES = {
  mesbiens: 'mesbiens',
  'mes biens': 'mesbiens',
  biens: 'mesbiens',
  share: 'share',
  partager: 'share',
  partage: 'share',
  aide: 'aide',
  help: 'aide',
};

const NOT_AN_AGENT =
  'Les commandes « ! » sont réservées aux agents dont le numéro est vérifié sur Lukka Place. Créez ou vérifiez votre compte : https://lukkaplace.com/compte/agent/inscription';
const UNAVAILABLE = 'Le service est momentanément indisponible. Réessayez dans quelques minutes.';
const UNKNOWN =
  'Commande inconnue. Commandes disponibles : !mesbiens, !share suivi du numéro de l’annonce (ex. !share 310), !aide.';

/**
 * `{ command, listingId }` for a command, `{ command: 'unknown' }` for "!" text
 * that is not one, null for anything that is not a command at all.
 */
function parseAgentCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('!') || raw.length >= MAX_COMMAND_LENGTH) return null;
  const body = raw
    .slice(1)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const match = /^([a-z]+(?: biens)?)(?:\s*(?:n°|no|#)?\s*(\d{1,10}))?$/.exec(body);
  if (!match) return { command: 'unknown' };
  const command = ALIASES[match[1]];
  if (!command) return { command: 'unknown' };
  return { command, listingId: match[2] ? Number.parseInt(match[2], 10) : null };
}

function webBaseUrl() {
  return (process.env.WEB_BASE_URL || process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

async function askWeb({ agentId, command, listingId }, fetchImpl = fetch) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${webBaseUrl()}/api/internal/agent-command`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, command, listingId }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.text !== 'string') throw new Error(`web answered ${response.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{handled: boolean, command?: string, reply?: string, reason?: string}>}
 */
async function handleAgentCommand({ from, text, identify = identifySender, fetchImpl = fetch, send = null }) {
  const parsed = parseAgentCommand(text);
  if (!parsed) return { handled: false };
  const reply = async (message) => {
    try {
      if (send) await send(from, message);
      else await chakra.sendWhatsAppMessage(from, message, { previewUrl: false });
    } catch (err) {
      console.error(`[agent-command] reply to ${from} failed: ${err.message}`);
    }
    return message;
  };

  const identity = await identify(from);
  if (!identity?.registered || !identity.agentId) {
    console.log(`[agent-command] '${parsed.command}' from ${from} refused — not a verified agent`);
    return { handled: true, command: parsed.command, reason: 'not-an-agent', reply: await reply(NOT_AN_AGENT) };
  }
  if (parsed.command === 'unknown') return { handled: true, command: 'unknown', reply: await reply(UNKNOWN) };

  try {
    const result = await askWeb({ agentId: identity.agentId, command: parsed.command, listingId: parsed.listingId }, fetchImpl);
    console.log(`[agent-command] '${parsed.command}' for agent #${identity.agentId}: ${result.ok ? 'ok' : 'refused'}`);
    return { handled: true, command: parsed.command, reply: await reply(result.text) };
  } catch (err) {
    console.error(`[agent-command] '${parsed.command}' for agent #${identity.agentId} failed: ${err.message}`);
    return { handled: true, command: parsed.command, reason: 'unavailable', reply: await reply(UNAVAILABLE) };
  }
}

module.exports = {
  parseAgentCommand,
  handleAgentCommand,
  MAX_COMMAND_LENGTH,
  NOT_AN_AGENT,
  UNAVAILABLE,
  UNKNOWN,
};
