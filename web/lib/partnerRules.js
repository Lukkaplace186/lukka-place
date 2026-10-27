import { normaliseReferralCode } from './launchCommission';

/**
 * Partners: whoever brings people to Lukka Place with a code of their own —
 * an agent sharing their listings, a TikTok creator, a campaign. Pure rules,
 * shared by the /go route, middleware.js, the signup actions and the tests;
 * lib/partners.js does the reads and writes.
 *
 * ONE CODE NAMESPACE WITH THE SALES REPS. A partner code has the sales-rep
 * shape (JEAN01, lib/launchCommission.js) and the database refuses a code the
 * other table already holds (migrations/20261027_growth_attribution.sql), so
 * `/go/JEAN01` can always tell whose code it is. A rep's code keeps its own
 * path: /go/<rep code> hands over to /r/<rep code>, which opens agent signup
 * and feeds the rep commission ledger exactly as before.
 *
 * FIRST VALID REFERRAL WINS, as for the reps. `lp_ref` (30 days) is set only
 * when the browser does not already carry a valid partner code, so a second
 * partner's link opened later does not take the visitor over. It is a
 * separate cookie from the reps' `lukka_ref`: a rep's code prefills the agent
 * signup form and is checked against `sales_reps`, a partner code is not.
 */

export const PARTNER_COOKIE = 'lp_ref';
export const PARTNER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** `campaign` is a code the team makes for one channel (a flyer, a radio spot). */
export const PARTNER_KINDS = ['agent', 'creator', 'campaign'];

/** How the click arrived: a /go link, its printed QR code, or `?ref=` on any page. */
export const PARTNER_CLICK_VIAS = ['link', 'qr', 'param'];

/** utm_source a partner's link tags the visit with, by kind. */
export const PARTNER_UTM_SOURCE = { agent: 'agent', creator: 'influencer', campaign: 'campagne' };
export const PARTNER_UTM_MEDIUM = 'partner';

export { normaliseReferralCode as normalisePartnerCode };

/** `NADIA01.qr` → { code: 'NADIA01', via: 'qr' }; anything else → null. */
export function parsePartnerCookie(value) {
  const [code, via] = String(value ?? '').split('.');
  const clean = normaliseReferralCode(code);
  return clean ? { code: clean, via: PARTNER_CLICK_VIAS.includes(via) ? via : 'link' } : null;
}

export function partnerCookieValue(code, via) {
  return `${code}.${PARTNER_CLICK_VIAS.includes(via) ? via : 'link'}`;
}

/** The paths `?ref=` must not be taken from: agent signup reads its own `?ref=` (a rep's code). */
const REF_PARAM_EXEMPT = ['/compte/agent/inscription', '/go', '/r', '/api', '/admin', '/_next'];

/** Whether middleware.js should turn this page's `?ref=` into a partner click. */
export function refParamApplies(pathname) {
  const path = String(pathname || '');
  return !REF_PARAM_EXEMPT.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Where `/go/<code>/<rest>` lands: `/go/NADIA01` → `/`, `/go/NADIA01/387` →
 * `/listings/387`. Anything else is the homepage.
 */
export function destinationForRest(rest) {
  const parts = Array.isArray(rest) ? rest : [];
  if (parts.length === 1 && /^\d{1,18}$/.test(parts[0])) return `/listings/${parts[0]}`;
  return '/';
}

/**
 * A `?to=` destination the /go route may send someone to: a path on this
 * site, never another host, never /go itself (a loop), never the API.
 */
export function safeDestination(value) {
  const text = String(value ?? '');
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\')) return null;
  if (/^\/(go|api|_next)(\/|$|\?)/.test(text)) return null;
  return text.slice(0, 1000);
}

/**
 * The destination with the partner's campaign tags, unless it already carries
 * a utm_source (an agent's shared link says which way out it took —
 * wa_status, wa_message… — and that stays the source).
 */
export function taggedDestination(destination, partner) {
  const url = new URL(destination, 'https://lukkaplace.invalid');
  url.searchParams.delete('ref');
  if (!url.searchParams.get('utm_source')) {
    url.searchParams.set('utm_source', PARTNER_UTM_SOURCE[partner.kind] || 'partenaire');
    url.searchParams.set('utm_medium', PARTNER_UTM_MEDIUM);
    url.searchParams.set('utm_content', String(partner.code).toLowerCase());
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `?ref=` removed from a URL's search string ('' when nothing is left). */
export function searchWithoutRef(search) {
  const params = new URLSearchParams(search || '');
  params.delete('ref');
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * The letter stems a new partner's code may use, in order: the name's first
 * word of 3+ letters (accents folded, 10 at most), then `LP` + the id spelled
 * in letters, so a name with no usable letters ("243…", emoji) still gets one.
 */
export function partnerCodeStems(name, { fallbackId = null } = {}) {
  const stems = [];
  const letters = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Z]/g, ''))
    .find((part) => part.length >= 3);
  if (letters) stems.push(letters.slice(0, 10));
  if (fallbackId != null && Number.isSafeInteger(Number(fallbackId))) stems.push(`LP${idLetters(Number(fallbackId))}`.slice(0, 10));
  return stems;
}

/** The first free code over the stems (`MARIE01`, `MARIE02`…), skipping `taken`; null when none is left. */
export function suggestPartnerCode(name, taken = [], { fallbackId = null } = {}) {
  const used = new Set((taken || []).map((code) => String(code).toUpperCase()));
  for (const stem of partnerCodeStems(name, { fallbackId })) {
    for (let n = 1; n <= 99; n += 1) {
      const code = `${stem}${String(n).padStart(2, '0')}`;
      if (!used.has(code)) return code;
    }
  }
  return null;
}

/** 0 → A, 25 → Z, 26 → BA … (base 26, letters only, at least one letter). */
function idLetters(id) {
  let n = Math.max(0, Math.floor(id));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out.length < 1 ? 'A' : out;
}

/** Currencies and fee bases a creator or campaign deal is recorded in. */
export const PARTNER_FEE_CURRENCIES = ['USD', 'CDF'];
export const PARTNER_FEE_BASES = ['flat', 'per_signup'];

/**
 * What one verified account cost: a per-signup fee is itself; a flat fee is
 * divided by every verified account the partner ever brought (the deal is
 * not per period). Null when no fee is recorded, or a flat fee has brought
 * no verified account yet — never "0 $".
 *
 * @returns {{amount: number, currency: string}|null}
 */
export function costPerAccount(fee, verifiedAll) {
  if (!fee || !(fee.amount >= 0) || !PARTNER_FEE_CURRENCIES.includes(fee.currency)) return null;
  if (fee.basis === 'per_signup') return { amount: fee.amount, currency: fee.currency };
  if (fee.basis === 'flat' && verifiedAll > 0) return { amount: Math.round((fee.amount / verifiedAll) * 100) / 100, currency: fee.currency };
  return null;
}

/**
 * The console form's fields, checked. Throws a code (not a message) the page
 * maps to its own copy.
 *
 * @returns {{kind, name, handle, notes, code, fee, status}}
 */
export function parsePartnerForm(fields, { creating = true } = {}) {
  const get = (name) => String(fields?.[name] ?? '').trim();
  const kind = get('kind');
  if (creating && !['creator', 'campaign'].includes(kind)) throw new Error('kind');
  const name = get('name').slice(0, 160);
  if (!name) throw new Error('name');
  const rawCode = get('code');
  const code = rawCode ? normaliseReferralCode(rawCode) : null;
  if (rawCode && !code) throw new Error('code_format');
  const handle = get('handle').slice(0, 120) || null;
  const notes = get('notes').slice(0, 2000) || null;
  const amountText = get('fee_amount').replace(/\s/g, '').replace(',', '.');
  let fee = null;
  if (amountText) {
    const amount = Number(amountText);
    const currency = get('fee_currency') || 'USD';
    const basis = get('fee_basis') || 'flat';
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) throw new Error('fee');
    if (!PARTNER_FEE_CURRENCIES.includes(currency) || !PARTNER_FEE_BASES.includes(basis)) throw new Error('fee');
    fee = { amount: Math.round(amount * 100) / 100, currency, basis };
  }
  const status = get('status') === 'inactive' ? 'inactive' : 'active';
  return { kind, name, handle, notes, code, fee, status };
}

/** A partner's shareable links. `listingId` makes a per-video / per-post link. */
export function partnerLinks(code, { siteUrl = 'https://lukkaplace.com', listingId = null } = {}) {
  const base = `${siteUrl.replace(/\/+$/, '')}/go/${encodeURIComponent(code)}`;
  const id = Number.parseInt(listingId, 10);
  return {
    home: base,
    listing: Number.isSafeInteger(id) && id > 0 ? `${base}/${id}` : null,
    invite: `${siteUrl.replace(/\/+$/, '')}/i/${encodeURIComponent(code)}`,
    qr: `${base}?src=qr`,
  };
}
