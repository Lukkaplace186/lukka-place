/**
 * services/whatsapp.js
 *
 * Thin wrapper over the WhatsApp Cloud API (Meta Graph API) for talking back to
 * Lukka Place agents: send text, send approved templates, mark messages read,
 * and pull down media (listing photos) so the parser can look at them.
 */

const axios = require('axios');

const GRAPH_VERSION = process.env.GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing — set it in .env`);
  }
  return value;
}

/** Axios client for the messages endpoint of our own phone number. */
function messagesClient() {
  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  return axios.create({
    baseURL: `${GRAPH_BASE}/${phoneNumberId}`,
    headers: {
      Authorization: `Bearer ${requireEnv('WHATSAPP_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

/**
 * Graph errors are nested and axios's default message ("Request failed with
 * status code 400") hides them, so surface the real reason in the throw.
 */
function rethrowGraphError(err, action) {
  const graphError = err.response?.data?.error;
  if (graphError) {
    const detail = graphError.error_user_msg || graphError.message;
    throw new Error(
      `WhatsApp API ${action} failed (${err.response.status} / code ${graphError.code}): ${detail}`,
    );
  }
  throw new Error(`WhatsApp API ${action} failed: ${err.message}`);
}

/**
 * Send a plain text message.
 *
 * Only works inside the 24h customer service window; outside it, Meta rejects
 * the send and you must use `sendTemplate()` instead.
 *
 * @param {string} to        Recipient wa_id / E.164 number without '+'.
 * @param {string} body      Message text (max 4096 chars).
 * @param {Object} [options]
 * @param {boolean} [options.previewUrl=false] Render a link preview.
 * @param {string}  [options.replyToMessageId] Quote the agent's message.
 */
async function sendText(to, body, { previewUrl = false, replyToMessageId } = {}) {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: previewUrl, body },
  };

  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  try {
    const { data } = await messagesClient().post('/messages', payload);
    return data;
  } catch (err) {
    return rethrowGraphError(err, `sendText to ${to}`);
  }
}

/**
 * Send a pre-approved message template — the only way to re-open a conversation
 * after the 24h window (e.g. "your listing is live", "we need one more detail").
 *
 * @param {string} to
 * @param {string} templateName    Name as approved in the Meta dashboard.
 * @param {Object} [options]
 * @param {string}   [options.languageCode='fr'] Template locale.
 * @param {string[]} [options.bodyParams=[]]     Ordered {{1}}, {{2}} values.
 */
async function sendTemplate(to, templateName, { languageCode = 'fr', bodyParams = [] } = {}) {
  const template = {
    name: templateName,
    language: { code: languageCode },
  };

  if (bodyParams.length) {
    template.components = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
      },
    ];
  }

  try {
    const { data } = await messagesClient().post('/messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template,
    });
    return data;
  } catch (err) {
    return rethrowGraphError(err, `sendTemplate '${templateName}' to ${to}`);
  }
}

/**
 * Show the blue read receipt so the agent knows the engine picked the message
 * up while parsing is still running.
 *
 * @param {string} messageId The inbound message's `id` (wamid...).
 */
async function markAsRead(messageId) {
  try {
    const { data } = await messagesClient().post('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
    return data;
  } catch (err) {
    return rethrowGraphError(err, `markAsRead ${messageId}`);
  }
}

/**
 * Download an inbound image/document by media ID.
 *
 * Two hops, both required by the Cloud API: resolve the media ID to a
 * short-lived signed URL, then fetch the bytes with the bearer token attached
 * (the CDN rejects unauthenticated reads).
 *
 * @param {string} mediaId `image.id` from the webhook payload.
 * @returns {Promise<{data: string, mimeType: string, sizeBytes: number}>}
 *          base64 payload shaped for `aiParser.parseListing({ images })`.
 */
async function downloadMedia(mediaId) {
  const token = requireEnv('WHATSAPP_TOKEN');
  const authHeader = { Authorization: `Bearer ${token}` };

  try {
    const { data: meta } = await axios.get(`${GRAPH_BASE}/${mediaId}`, {
      headers: authHeader,
      timeout: 15000,
    });

    const { data: bytes } = await axios.get(meta.url, {
      headers: authHeader,
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const buffer = Buffer.from(bytes);
    return {
      data: buffer.toString('base64'),
      mimeType: meta.mime_type,
      sizeBytes: buffer.length,
    };
  } catch (err) {
    return rethrowGraphError(err, `downloadMedia ${mediaId}`);
  }
}

module.exports = {
  sendText,
  sendTemplate,
  markAsRead,
  downloadMedia,
};
