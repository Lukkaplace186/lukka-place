/**
 * services/voiceNotes.js
 *
 * WhatsApp voice notes → text, so an agent can SAY the listing.
 *
 * Kinshasa agents dictate far more than they type, and a voice note used to
 * get "les autres formats (… audio …) ne sont pas encore pris en charge". The
 * transcript is folded into the message text exactly like a PDF flyer's text
 * layer (routes/webhook.js), so extraction, the correction loop ("non c'est
 * 570") and confirmation all work on a spoken message unchanged.
 *
 * No language is forced: agents mix French and Lingala, and pinning 'fr'
 * makes the model translate Lingala badly instead of transcribing it. The
 * prompt carries the vocabulary a generic model mishears — commune names,
 * "garantie", "3 + 1 + 1".
 */

const { OpenAI, toFile } = require('openai');

/** WhatsApp caps voice notes well below this; anything larger is not one. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const MODEL = process.env.VOICE_TRANSCRIBE_MODEL || 'whisper-1';

const VOCABULARY_PROMPT =
  "Annonce immobilière à Kinshasa. Appartement, parcelle, villa, studio, chambres, salles de bain, " +
  'garantie, avance, commission, 3 + 1 + 1, dollars, à louer, à vendre. Gombe, Ngaliema, Limete, ' +
  'Lingwala, Kintambo, Bandalungwa, Kasa-Vubu, Kalamu, Lemba, Ngiri-Ngiri, Barumbu, Masina, Ndjili, ' +
  'Matete, Mont-Ngafula, Selembao, Makala, Bumbu, Kimbanseke, Kisenso, Ngaba, Nsele, Maluku, Kinshasa.';

let client;
let transcriberOverride = null;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/** WhatsApp sends audio/ogg (opus); the extension is what the API keys the decoder on. */
function extensionFor(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  return 'ogg';
}

function isAudioMime(mimeType) {
  return /^audio\/|opus|ogg/i.test(String(mimeType || ''));
}

/**
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @returns {Promise<{ok: true, text: string}|{ok: false, reason: string}>}
 */
async function transcribeAudio(buffer, mimeType) {
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty' };
  if (buffer.length > MAX_AUDIO_BYTES) return { ok: false, reason: 'too_large' };
  if (transcriberOverride) return transcriberOverride(buffer, mimeType);

  const file = await toFile(buffer, `voice.${extensionFor(mimeType)}`, { type: mimeType || 'audio/ogg' });
  const result = await getClient().audio.transcriptions.create({
    file,
    model: MODEL,
    prompt: VOCABULARY_PROMPT,
    temperature: 0,
  });
  const text = String(result?.text || '').trim();
  return text ? { ok: true, text } : { ok: false, reason: 'no_speech' };
}

/** Tests replace the network call; pass null to restore it. */
function setTranscriber(fn) {
  transcriberOverride = fn;
}

module.exports = { transcribeAudio, isAudioMime, setTranscriber, MAX_AUDIO_BYTES };
