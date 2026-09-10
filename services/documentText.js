/**
 * services/documentText.js
 *
 * Reads the text out of a PDF flyer so it can go through the ordinary
 * extraction path.
 *
 * WHY
 * ---
 * Agencies routinely send their marketing flyer as a PDF rather than typing
 * the listing out. routes/webhook.js used to answer every one of those with
 * "send it as text or a photo" — a flat rejection of a document that contains
 * the whole listing.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not OCR. A PDF that is just a scanned image carries no text layer, and
 * extracting nothing from it is the correct, honest outcome — the caller then
 * asks the agent for a photo instead, which routes into the vision model that
 * CAN read it. Pretending otherwise would silently drop listings.
 *
 * pdf-parse is the one new dependency here: Node has no PDF reader, and the
 * alternative (rasterising pages and sending them to the vision model) needs a
 * native canvas build for a job a text layer already answers.
 */

const MAX_PDF_BYTES = Number.parseInt(process.env.MAX_PDF_BYTES, 10) || 10 * 1024 * 1024;

/**
 * Enough characters to be a listing rather than a stray header or a page
 * number picked out of a scan. Below this we treat the PDF as having no
 * usable text and ask for a photo instead.
 */
const MIN_USEFUL_CHARS = 40;

/** Cap what reaches the model: a 40-page brochure is not a listing, and the
 *  listing is essentially always on the first page. */
const MAX_EXTRACTED_CHARS = 6000;

function isPdf(mimeType, buffer) {
  if (mimeType && String(mimeType).toLowerCase().includes('pdf')) return true;
  // Trust the bytes over the declared type — WhatsApp sometimes sends
  // application/octet-stream for a document.
  return Boolean(buffer && buffer.length > 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF');
}

/**
 * Extract the text layer of a PDF.
 *
 * Never throws: a malformed, encrypted or image-only PDF returns
 * `{ ok: false }` with a reason, because the caller's job is to answer the
 * agent either way.
 *
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @returns {Promise<{ok: boolean, text: string, reason?: string, pages?: number}>}
 */
async function extractPdfText(buffer, mimeType) {
  if (!buffer || !buffer.length) return { ok: false, text: '', reason: 'empty' };
  if (buffer.length > MAX_PDF_BYTES) return { ok: false, text: '', reason: 'too-large' };
  if (!isPdf(mimeType, buffer)) return { ok: false, text: '', reason: 'not-pdf' };

  let parser;
  try {
    // Required lazily so the engine still boots if this optional dependency is
    // missing — a PDF then falls back to the existing "send a photo" reply
    // instead of taking the whole webhook down.
    const { PDFParse } = require('pdf-parse');
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    const text = String(result?.text || '')
      // Flyer layouts produce runs of blank lines and padding spaces that cost
      // tokens and tell the model nothing.
      .replace(/[ \t ]+/g, ' ')
      // pdf-parse marks page boundaries with "-- 1 of 3 --". Useful in a dump
      // a human reads, pure noise to the extraction model.
      .replace(/^[ 	]*--\s*\d+\s+of\s+\d+\s*--[ 	]*$/gim, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length < MIN_USEFUL_CHARS) {
      // Almost certainly a scanned flyer: real content, no text layer.
      return { ok: false, text: '', reason: 'no-text-layer', pages: result?.total };
    }

    return { ok: true, text: text.slice(0, MAX_EXTRACTED_CHARS), pages: result?.total };
  } catch (err) {
    console.warn(`[pdf] could not read document: ${err.message}`);
    return { ok: false, text: '', reason: 'unreadable' };
  } finally {
    // pdf-parse holds a worker/document handle open otherwise.
    try {
      await parser?.destroy?.();
    } catch {
      /* nothing useful to do if teardown fails */
    }
  }
}

module.exports = {
  extractPdfText,
  isPdf,
  MAX_PDF_BYTES,
  MIN_USEFUL_CHARS,
  MAX_EXTRACTED_CHARS,
};
