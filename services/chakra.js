/**
 * services/chakra.js
 *
 * Outbound messages via Chakra Chat (ChakraHQ).
 *
 * Chakra is a thin pass-through over Meta's WhatsApp Cloud API: the URL is
 * Chakra's, the request body is Meta's standard messages payload. That means the
 * session-window rules still apply — a free-form text message only reaches the
 * agent inside the 24h customer-service window; outside it you need an approved
 * template (`sendTemplate` below).
 *
 * Endpoint shape (from Chakra's API docs):
 *   POST {CHAKRA_API_BASE}/v1/ext/plugin/whatsapp/{pluginId}/api/{apiVersion}/{phoneNumberId}/messages
 *   Authorization: Bearer <access token>
 */

const axios = require('axios');

const API_BASE = process.env.CHAKRA_API_BASE || 'https://api.chakrahq.com';
const API_VERSION = process.env.CHAKRA_WHATSAPP_API_VERSION || 'v21.0';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing — set it in .env`);
  }
  return value;
}

/** Full messages URL for our plugin + phone number. */
function messagesUrl() {
  const pluginId = requireEnv('CHAKRA_PLUGIN_ID');
  const phoneNumberId = requireEnv('CHAKRA_PHONE_NUMBER_ID');
  return `${API_BASE}/v1/ext/plugin/whatsapp/${pluginId}/api/${API_VERSION}/${phoneNumberId}/messages`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${requireEnv('CHAKRA_ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

/**
 * A request made with `responseType: 'arraybuffer'` (the media downloads)
 * gets its error body back as raw bytes too, not parsed JSON — decode it back
 * to text/JSON so the error message is readable instead of a dumped byte array.
 */
function decodeErrorData(data) {
  if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
    return data;
  }
  try {
    const text = Buffer.from(data).toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return data;
  }
}

/**
 * Chakra forwards Meta's error envelope, and axios's default message ("Request
 * failed with status code 400") hides it — surface the real reason instead.
 */
function rethrowChakraError(err, action) {
  const data = decodeErrorData(err.response?.data);
  const graphError = data?.error;
  const status = err.response?.status;

  if (graphError) {
    const detail = graphError.error_user_msg || graphError.message;
    throw new Error(`Chakra ${action} failed (${status} / code ${graphError.code}): ${detail}`);
  }
  if (data) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data).slice(0, 300);
    throw new Error(`Chakra ${action} failed (${status}): ${detail}`);
  }
  throw new Error(`Chakra ${action} failed: ${err.message}`);
}

/**
 * Send a plain text WhatsApp message.
 *
 * @param {string} toPhone      Recipient in E.164 without '+' (e.g. 243810000000).
 * @param {string} messageText  Body text (WhatsApp caps at 4096 chars).
 * @param {Object} [options]
 * @param {boolean} [options.previewUrl=false]  Render a link preview.
 * @param {string}  [options.replyToMessageId]  Quote the agent's message.
 * @returns {Promise<Object>} Chakra/Meta response body.
 */
async function sendWhatsAppMessage(toPhone, messageText, { previewUrl = false, replyToMessageId } = {}) {
  if (!toPhone) {
    throw new Error('sendWhatsAppMessage requires toPhone');
  }
  if (!messageText || !String(messageText).trim()) {
    throw new Error('sendWhatsAppMessage requires non-empty messageText');
  }

  // Leading '+' is valid E.164 but not accepted here.
  const to = String(toPhone).replace(/^\+/, '');

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: previewUrl, body: String(messageText) },
  };

  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  try {
    const { data } = await axios.post(messagesUrl(), payload, {
      headers: authHeaders(),
      timeout: 15000,
    });
    return data;
  } catch (err) {
    return rethrowChakraError(err, `sendWhatsAppMessage to ${to}`);
  }
}

/**
 * Send a pre-approved template — the only way to re-open a conversation after
 * the 24h session window has closed.
 *
 * @param {string} toPhone
 * @param {string} templateName  Name as approved in the WhatsApp Manager.
 * @param {Object} [options]
 * @param {string}   [options.languageCode='fr']
 * @param {string[]} [options.bodyParams=[]]  Ordered {{1}}, {{2}} values.
 */
async function sendTemplate(toPhone, templateName, { languageCode = 'fr', bodyParams = [], otpCode } = {}) {
  const to = String(toPhone).replace(/^\+/, '');

  const template = { name: templateName, language: { code: languageCode } };
  if (bodyParams.length) {
    template.components = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
      },
    ];
  }

  // Meta's AUTHENTICATION-category templates (the only category allowed to
  // carry a one-time code) are rejected without their copy-code button
  // component alongside the body — the code has to be supplied twice, once
  // for the message text and once for the button that copies it. Passing
  // `otpCode` adds that component. Omit it for a plain UTILITY/MARKETING
  // template, where sending a button component the template doesn't declare
  // is itself an error.
  if (otpCode) {
    template.components = template.components || [];
    template.components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: String(otpCode) }],
    });
  }

  try {
    const { data } = await axios.post(
      messagesUrl(),
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template },
      { headers: authHeaders(), timeout: 15000 },
    );
    return data;
  } catch (err) {
    return rethrowChakraError(err, `sendTemplate '${templateName}' to ${to}`);
  }
}

/**
 * Show the blue read receipt so the agent sees the engine picked their message
 * up while extraction is still running.
 */
async function markAsRead(messageId) {
  try {
    const { data } = await axios.post(
      messagesUrl(),
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      { headers: authHeaders(), timeout: 15000 },
    );
    return data;
  } catch (err) {
    return rethrowChakraError(err, `markAsRead ${messageId}`);
  }
}

// ---------------------------------------------------------------------------
// Inbound media
// ---------------------------------------------------------------------------

/**
 * Media endpoints — Chakra's own "Media APIs" (apidocs.chakrahq.com), not Meta's
 * pass-through shape the messages endpoint uses. Both are single-hop: they
 * stream the bytes back directly rather than returning a signed URL to fetch in
 * a second request.
 *
 *   GET /v2/whatsapp/{apiVersion}/media/{mediaId}/show
 *     — download by the WhatsApp media id (`image.id` in the webhook payload).
 *
 *   GET /v2/whatsapp/{apiVersion}/media/whatsapp_business/attachments?mid={mid}
 *     — download by the `mid` query param embedded in the signed
 *       lookaside.fbsbx.com URL the webhook payload also carries (`image.url`).
 *       This is Chakra's own proxy for that Meta CDN link, authenticated with
 *       the *Chakra* token — hitting lookaside.fbsbx.com directly instead
 *       fails with 401, since it expects a Meta token we don't have.
 *
 * An override remains available (CHAKRA_MEDIA_URL_TEMPLATE, {mediaId} only) in
 * case a given Chakra account is on a different API shape.
 */
const MEDIA_API_BASE = `${API_BASE}/v2/whatsapp/${API_VERSION}/media`;

/** Refuse absurdly large downloads rather than buffering them into memory. */
const MAX_MEDIA_BYTES = Number.parseInt(process.env.CHAKRA_MAX_MEDIA_BYTES, 10) || 20 * 1024 * 1024;

function mediaUrl(mediaId) {
  const template = process.env.CHAKRA_MEDIA_URL_TEMPLATE;
  if (template) {
    return template
      .replace('{base}', API_BASE)
      .replace('{pluginId}', process.env.CHAKRA_PLUGIN_ID || '')
      .replace('{apiVersion}', API_VERSION)
      .replace('{phoneNumberId}', process.env.CHAKRA_PHONE_NUMBER_ID || '')
      .replace('{mediaId}', String(mediaId));
  }
  return `${MEDIA_API_BASE}/${encodeURIComponent(mediaId)}/show`;
}

function mediaAttachmentUrl(mid) {
  return `${MEDIA_API_BASE}/whatsapp_business/attachments?mid=${encodeURIComponent(mid)}`;
}

/** Pull the `mid` query param out of a lookaside.fbsbx.com attachment URL. */
function extractMid(url) {
  try {
    return new URL(String(url)).searchParams.get('mid');
  } catch {
    return null;
  }
}

/**
 * Identify an image from its magic bytes.
 *
 * Only used when the provider omits `mime_type`: labelling a PNG as JPEG in the
 * data URI is the kind of mismatch that makes the vision call fail for reasons
 * that look nothing like the actual cause.
 */
function sniffMimeType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && buffer.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return 'image/png';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Turn downloaded bytes into the shape openai.parseMessage({ images }) wants.
 * Sniffing wins over the declared type: a mismatch between the two is exactly
 * what makes a vision call fail for reasons that look unrelated.
 */
function toImagePayload(rawBytes, mimeTypeHint, label) {
  const buffer = Buffer.from(rawBytes);

  if (buffer.length === 0) {
    throw new Error(`Media ${label} downloaded as 0 bytes`);
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new Error(`Media ${label} is ${buffer.length} bytes, over the ${MAX_MEDIA_BYTES} limit`);
  }

  const sniffed = sniffMimeType(buffer);
  const hint = String(mimeTypeHint || '').split(';')[0].trim().toLowerCase();
  const mimeType = sniffed || (hint.startsWith('image/') ? hint : null);

  if (!mimeType) {
    // Typically an HTML error page served with status 200.
    throw new Error(`Media ${label}: response is not a recognised image`);
  }

  return { data: buffer.toString('base64'), mimeType, sizeBytes: buffer.length };
}

/**
 * Download an image via the URL embedded in the webhook payload.
 *
 * That URL is a signed lookaside.fbsbx.com link — Meta's own CDN, which needs a
 * Meta access token we don't have (our CHAKRA_ACCESS_TOKEN gets a 401 there).
 * Chakra proxies exactly this link through its own attachments endpoint,
 * keyed on the same `mid` the lookaside URL carries, authenticated with our
 * normal Chakra token — so that's the request actually made here.
 *
 * @param {string} url
 * @param {string} [mimeTypeHint] `mime_type` from the payload, if present.
 */
async function downloadMediaByUrl(url, mimeTypeHint) {
  if (!url) {
    throw new Error('downloadMediaByUrl requires a url');
  }

  const mid = extractMid(url);
  const token = process.env.CHAKRA_MEDIA_TOKEN || requireEnv('CHAKRA_ACCESS_TOKEN');

  // No `mid` to proxy through Chakra (an unrecognised URL shape) — best effort,
  // try the URL as given rather than failing outright.
  const target = mid ? mediaAttachmentUrl(mid) : String(url);

  let bytes;
  try {
    ({ data: bytes } = await axios.get(target, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 30000,
      // Chakra's docs: don't forward the Authorization header if this redirects
      // to the actual CDN — it isn't meant for that host, and leaking a bearer
      // token to a third-party redirect target is the kind of thing worth
      // guarding against even when the header would otherwise just be ignored.
      beforeRedirect: (options) => {
        delete options.headers.Authorization;
      },
    }));
  } catch (err) {
    rethrowChakraError(err, `downloadMediaByUrl ${target.slice(0, 80)}`);
  }

  return toImagePayload(bytes, mimeTypeHint, String(url).slice(0, 60));
}

/**
 * Download an inbound image by media id.
 *
 * One hop: Chakra's "Show WhatsApp Media" endpoint streams the bytes directly
 * (unlike Meta's own API, there's no separate metadata call for a signed URL).
 *
 * @param {string} mediaId `image.id` from the inbound webhook.
 * @returns {Promise<{data: string, mimeType: string, sizeBytes: number}>}
 *          Shaped for `openai.parseMessage({ images })`.
 */
async function downloadMedia(mediaId) {
  if (!mediaId) {
    throw new Error('downloadMedia requires a mediaId');
  }

  const token = requireEnv('CHAKRA_ACCESS_TOKEN');

  let bytes;
  let contentType;
  try {
    const response = await axios.get(mediaUrl(mediaId), {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 30000,
      beforeRedirect: (options) => {
        delete options.headers.Authorization;
      },
    });
    bytes = response.data;
    contentType = response.headers?.['content-type'];
  } catch (err) {
    rethrowChakraError(err, `downloadMedia ${mediaId}`);
  }

  if (contentType && !String(contentType).split(';')[0].trim().toLowerCase().startsWith('image/')) {
    // Voice notes and PDFs land here; the vision model cannot read them.
    throw new Error(`Media ${mediaId} is '${contentType}', not an image`);
  }

  return toImagePayload(bytes, contentType, mediaId);
}

module.exports = {
  sendWhatsAppMessage,
  sendTemplate,
  markAsRead,
  downloadMedia,
  downloadMediaByUrl,
  messagesUrl,
  mediaUrl,
  mediaAttachmentUrl,
  extractMid,
  sniffMimeType,
  MAX_MEDIA_BYTES,
};
