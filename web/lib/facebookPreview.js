import 'server-only';

/**
 * Facebook's link preview for a listing link, made BEFORE anyone posts it
 * (2026-11-05).
 *
 * Reported the same day: of three listings the team posted on the Lukka Place
 * Facebook page within minutes, one showed the og:image card (photo, price,
 * title) and two showed a bare "LUKKAPLACE.COM / lukkaplace.com" box — Facebook
 * had failed to read those two links when they were posted. Both pages, their
 * og tags and their og:image answered 200 the next day, to Facebook's own user
 * agent and request headers; nothing on our side was down at that hour. What
 * makes it stick is Facebook's cache: it keeps the result of its first read of
 * a URL (query string included, so `?utm_source=lukka_reseaux` is its own
 * entry) for about a month, and every later post of that link reuses it.
 *
 * So the share dialog asks Facebook to read the exact link in the caption the
 * moment the 4:5 card is opened — Graph API `POST /?id=<url>&scrape=true` with
 * the app token — and checks that a title AND an image came back, retrying a
 * failed read. By the time the caption is pasted, Facebook's cache holds a
 * good preview. With no app configured (FACEBOOK_APP_ID + FACEBOOK_APP_SECRET,
 * or FACEBOOK_APP_TOKEN, read at call time) nothing is called and the dialog
 * offers the Sharing Debugger link instead, where "Scrape Again" does the
 * same by hand — and also repairs a post already published.
 */

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0';
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 20_000;
const RETRY_WAIT_MS = [2_000, 5_000];
/** A good read is trusted for this long before Facebook is asked again. */
const READY_TTL_MS = 6 * 60 * 60 * 1000;

const readyCache = new Map(); // url → { at, result }

/** The Sharing Debugger for one URL — "Scrape Again" refreshes Facebook's copy by hand. */
export function facebookDebuggerUrl(url) {
  return `https://developers.facebook.com/tools/debug/?q=${encodeURIComponent(url)}`;
}

/** The app access token ("id|secret"), or null when no Facebook app is configured. */
export function facebookAppToken(env = process.env) {
  const token = (env.FACEBOOK_APP_TOKEN || '').trim();
  if (token) return token;
  const id = (env.FACEBOOK_APP_ID || '').trim();
  const secret = (env.FACEBOOK_APP_SECRET || '').trim();
  return id && secret ? `${id}|${secret}` : null;
}

/**
 * What Facebook's scrape answered: 'ready' only with a real title AND an
 * image. A title that is just our domain is Facebook's failed-read
 * placeholder, never a success.
 *
 * @returns {{status: 'ready'|'no_image'|'failed', title: string|null, image: string|null, error?: string}}
 */
export function readScrapeAnswer(body) {
  if (!body || typeof body !== 'object') return { status: 'failed', title: null, image: null, error: 'empty' };
  if (body.error) return { status: 'failed', title: null, image: null, error: String(body.error.message || body.error.type || 'error').slice(0, 200) };
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const title = rawTitle && !/^(www\.)?lukkaplace\.com$/i.test(rawTitle) ? rawTitle : null;
  const first = Array.isArray(body.image) ? body.image.find((img) => img && typeof img.url === 'string' && img.url) : null;
  const image = first ? first.url : null;
  if (!title) return { status: 'failed', title: null, image, error: 'no-title' };
  return { status: image ? 'ready' : 'no_image', title, image };
}

async function scrapeOnce(url, token, fetchImpl) {
  const body = new URLSearchParams({ id: url, scrape: 'true', access_token: token });
  const response = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok && !json?.error) return { status: 'failed', title: null, image: null, error: `http-${response.status}` };
  return readScrapeAnswer(json);
}

/**
 * Ask Facebook to (re)read `url` now, until it holds a preview with a title
 * and an image, at most ATTEMPTS times. Never throws.
 *
 * @returns {Promise<{status: 'ready'|'no_image'|'failed'|'unconfigured', title?: string|null, image?: string|null, error?: string}>}
 */
export async function refreshFacebookPreview(url, { env = process.env, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const token = facebookAppToken(env);
  if (!token) return { status: 'unconfigured' };
  const cached = readyCache.get(url);
  if (cached && now() - cached.at < READY_TTL_MS) return cached.result;

  let last = { status: 'failed', title: null, image: null, error: 'not-tried' };
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(RETRY_WAIT_MS[attempt - 1] ?? RETRY_WAIT_MS.at(-1));
    try {
      last = await scrapeOnce(url, token, fetchImpl);
    } catch (err) {
      last = { status: 'failed', title: null, image: null, error: String(err?.name === 'TimeoutError' ? 'timeout' : err?.message || err).slice(0, 200) };
    }
    if (last.status === 'ready') {
      readyCache.set(url, { at: now(), result: last });
      return last;
    }
    // A refused token or app will refuse the next attempt too.
    if (/access token|OAuthException|application/i.test(last.error || '')) break;
  }
  console.warn(`[facebook-preview] ${url} → ${last.status}${last.error ? ` (${last.error})` : ''}`);
  return last;
}

/** Test hook: forget the good reads. */
export function _resetFacebookPreviewCache() {
  readyCache.clear();
}
