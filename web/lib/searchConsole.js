import 'server-only';
import { createSign } from 'node:crypto';

/**
 * Google Search Console, read-only, for /admin/seo: what people typed before
 * seeing lukkaplace.com in Google, our position for it, and the sitemap's
 * status — the only real source for "are we on page one?".
 *
 * Auth is a Google Cloud SERVICE ACCOUNT (no user login, no new dependency):
 * a JWT signed RS256 with node:crypto is exchanged for an access token. Setup,
 * once, by the owner:
 *   1. console.cloud.google.com → a project → enable "Google Search Console API".
 *   2. IAM → Service accounts → create one → Keys → Add key → JSON.
 *   3. search.google.com/search-console → lukkaplace.com → Settings → Users
 *      and permissions → add the service account's e-mail, permission
 *      "Restricted" (read is all this needs).
 *   4. web/.env.local: GSC_SERVICE_ACCOUNT_JSON=<the JSON, or it base64-encoded>
 *      and, when the property is not the domain property,
 *      GSC_PROPERTY=https://lukkaplace.com/ — then pm2 restart --update-env.
 *
 * Nothing here throws to a page: every call returns { ok, error } so an
 * unreachable Google never takes the console down.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TIMEOUT_MS = 12000;
const CACHE_MS = 10 * 60 * 1000;

/** The domain property verified by the DNS TXT record (2026-11-05). */
export const DEFAULT_GSC_PROPERTY = 'sc-domain:lukkaplace.com';

export function gscProperty() {
  return String(process.env.GSC_PROPERTY || '').trim() || DEFAULT_GSC_PROPERTY;
}

/**
 * The service account's key from the environment — raw JSON or base64 of it.
 * Null when unset or unreadable (the page then shows the setup steps).
 */
export function readServiceAccount(raw = process.env.GSC_SERVICE_ACCOUNT_JSON) {
  const text = String(raw || '').trim();
  if (!text) return null;
  for (const candidate of [text, Buffer.from(text, 'base64').toString('utf8')]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.client_email && parsed?.private_key) {
        return { clientEmail: parsed.client_email, privateKey: parsed.private_key, tokenUri: parsed.token_uri || TOKEN_URL };
      }
    } catch {
      // try the next reading
    }
  }
  return null;
}

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

/**
 * The signed assertion Google's token endpoint takes for a service account
 * (RFC 7523). Exported for the unit test, which verifies the signature.
 */
export function buildServiceAccountJwt({ clientEmail, privateKey, tokenUri = TOKEN_URL }, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = base64url({ alg: 'RS256', typ: 'JWT' });
  const claims = base64url({ iss: clientEmail, scope: SCOPE, aud: tokenUri, iat: nowSeconds, exp: nowSeconds + 3600 });
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(privateKey).toString('base64url')}`;
}

let tokenCache = { token: null, expiresAt: 0, email: null };

async function fetchJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.error?.message || body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(typeof message === 'string' ? message : `HTTP ${res.status}`);
  }
  return body;
}

async function accessToken(account) {
  if (tokenCache.token && tokenCache.email === account.clientEmail && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const body = await fetchJson(account.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildServiceAccountJwt(account),
    }),
  });
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000, email: account.clientEmail };
  return tokenCache.token;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** Last `days` days, ending today (Search Console's own data lags 2–3 days). */
export function dateRange(days, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

let reportCache = { at: 0, key: null, value: null };

/**
 * Everything /admin/seo shows from Search Console, in one call: totals,
 * queries (up to 1,000, for matching the target searches), top pages, the
 * English-speaking audience's queries and the sitemaps.
 *
 * @returns {Promise<{configured: boolean, ok: boolean, error?: string, property: string,
 *   serviceEmail?: string, range?: object, totals?: object, queries?: object[],
 *   pages?: object[], sitemaps?: object[]}>}
 */
export async function getSearchConsoleReport({ days = 28 } = {}) {
  const property = gscProperty();
  const account = readServiceAccount();
  if (!account) return { configured: false, ok: false, property };

  const key = `${property}|${days}|${account.clientEmail}`;
  if (reportCache.key === key && Date.now() - reportCache.at < CACHE_MS) return reportCache.value;

  const range = dateRange(days);
  let value;
  try {
    const token = await accessToken(account);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const site = encodeURIComponent(property);
    const query = (body) => fetchJson(`${API}/sites/${site}/searchAnalytics/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...range, ...body }),
    }).then((res) => res.rows || []);

    const [totalsRows, queries, pages, sitemaps] = await Promise.all([
      query({}),
      query({ dimensions: ['query'], rowLimit: 1000 }),
      query({ dimensions: ['page'], rowLimit: 20 }),
      fetchJson(`${API}/sites/${site}/sitemaps`, { headers }).then((res) => res.sitemap || []).catch(() => []),
    ]);
    const totals = totalsRows[0] || { clicks: 0, impressions: 0, ctr: 0, position: null };
    value = { configured: true, ok: true, property, serviceEmail: account.clientEmail, range, totals, queries, pages, sitemaps };
  } catch (err) {
    value = { configured: true, ok: false, property, serviceEmail: account.clientEmail, error: err.message };
  }
  reportCache = { at: Date.now(), key, value };
  return value;
}
