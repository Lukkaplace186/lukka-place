/**
 * "Trouver pour moi" without an account (2026-11-04): a visitor whose search
 * found nothing, or who lands on /trouver-pour-moi from an ad, leaves a
 * WhatsApp number and what they want, and that becomes a real `leads` row
 * the engine pushes to the agencies covering the commune — the same
 * POST /admin/leads the signed-in form uses (lib/adminApi.js createLead).
 *
 * Before this, the empty search linked to /compte/client/demandes, which
 * redirects a guest to sign in. A visitor from a Facebook ad does not open an
 * account to say what they want; 62 of 279 searches in the 30 days to
 * 2026-11-04 found nothing, and every one of those visitors hit that wall.
 *
 * Pure: the action (app/(site)/trouver-pour-moi/actions.js) does the I/O.
 */

export const GUEST_REQUEST_SOURCE = 'guest-search-request';

/** Kinds of property a guest can name. Not a filter: a request for a kind
 *  nobody lists yet is exactly the demand this form exists to capture. */
export const GUEST_REQUEST_TYPES = ['appartement', 'maison', 'studio', 'chambre', 'terrain', 'bureau'];

/** What the agency reads in the lead — French, whatever the visitor's UI language. */
const TYPE_SUMMARY_FR = {
  appartement: 'Appartement',
  maison: 'Maison',
  studio: 'Studio',
  chambre: 'Chambre',
  terrain: 'Terrain',
  bureau: 'Bureau / local commercial',
};

export const GUEST_REQUEST_TRANSACTIONS = ['location', 'vente'];
export const MAX_GUEST_BUDGET = 10_000_000;
export const MAX_GUEST_BEDROOMS = 10;
export const MAX_GUEST_NAME = 80;

/**
 * Validates what the form posted. `communes` is the allow-list from the
 * location hierarchy, read by the server — never taken from the form.
 *
 * @returns {{ok: true, request: object} | {ok: false, error: string}}
 *          `error` is a code the form turns into copy.
 */
export function parseGuestRequest(fields, communes = []) {
  const transactionType = GUEST_REQUEST_TRANSACTIONS.includes(fields.transactionType) ? fields.transactionType : null;
  if (!transactionType) return { ok: false, error: 'transaction' };

  const wanted = String(fields.commune || '').trim();
  const commune = communes.find((c) => c.toLowerCase() === wanted.toLowerCase()) || null;
  if (!commune) return { ok: false, error: 'commune' };

  const propertyType = GUEST_REQUEST_TYPES.includes(fields.propertyType) ? fields.propertyType : null;

  const budget = Number.parseFloat(String(fields.budgetMax ?? '').replace(/[\s$,]/g, ''));
  const budgetMax = Number.isFinite(budget) && budget > 0 && budget <= MAX_GUEST_BUDGET ? Math.round(budget) : null;
  if (String(fields.budgetMax ?? '').trim() && budgetMax === null) return { ok: false, error: 'budget' };

  const beds = Number.parseInt(String(fields.bedrooms ?? ''), 10);
  const bedrooms = Number.isInteger(beds) && beds >= 1 && beds <= MAX_GUEST_BEDROOMS ? beds : null;

  const name = String(fields.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GUEST_NAME) || null;

  return { ok: true, request: { transactionType, commune, propertyType, budgetMax, bedrooms, name } };
}

/** The type line put in front of the lead's summary, or null. */
export function guestTypeSummary(propertyType) {
  return TYPE_SUMMARY_FR[propertyType] || null;
}

/**
 * Prefill from the search that found nothing: `transaction_type`,
 * `commune`, `price_max`, `beds_min` and a `property_type` we know. Only
 * values the form can hold; anything else starts empty.
 */
export function guestRequestPrefill(params = {}, communes = []) {
  const commune = communes.find((c) => c.toLowerCase() === String(params.commune || '').toLowerCase()) || '';
  const type = String(params.property_type || '').toLowerCase();
  const budget = Number.parseFloat(params.price_max);
  const beds = Number.parseInt(params.beds_min, 10);
  return {
    transactionType: GUEST_REQUEST_TRANSACTIONS.includes(params.transaction_type) ? params.transaction_type : 'location',
    commune,
    propertyType: GUEST_REQUEST_TYPES.includes(type) ? type : '',
    budgetMax: Number.isFinite(budget) && budget > 0 ? String(Math.round(budget)) : '',
    bedrooms: Number.isInteger(beds) && beds >= 1 && beds <= MAX_GUEST_BEDROOMS ? String(beds) : '',
  };
}

/**
 * The /trouver-pour-moi link for the "Pas encore trouvé ?" card in the
 * /listings feed (2026-11-21, marketing plan: paid visitors see 1.25 pages
 * and the sign-up nudge never reaches them). It carries only the parts of the
 * visitor's search the request form can hold, under the same names
 * (guestRequestPrefill above re-checks every one), so the form opens on what
 * they were already looking for. Nothing is deduced: a search without a
 * commune leaves the commune for the visitor to choose.
 */
export function feedRequestHref(params = {}) {
  const pick = (key) => {
    const value = Array.isArray(params[key]) ? params[key][0] : params[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const qs = new URLSearchParams();
  const transaction = pick('transaction_type');
  if (GUEST_REQUEST_TRANSACTIONS.includes(transaction)) qs.set('transaction_type', transaction);
  const commune = pick('commune');
  if (commune) qs.set('commune', commune);
  const type = pick('property_type').toLowerCase();
  if (GUEST_REQUEST_TYPES.includes(type)) qs.set('property_type', type);
  const budget = Number.parseFloat(pick('price_max'));
  if (Number.isFinite(budget) && budget > 0 && budget <= MAX_GUEST_BUDGET) qs.set('price_max', String(Math.round(budget)));
  const beds = Number.parseInt(pick('beds_min'), 10);
  if (Number.isInteger(beds) && beds >= 1 && beds <= MAX_GUEST_BEDROOMS) qs.set('beds_min', String(beds));
  const query = qs.toString();
  return query ? `/trouver-pour-moi?${query}` : '/trouver-pour-moi';
}

/** The feed card follows the 6th result, or the last one of a shorter first page. */
export const FEED_REQUEST_AFTER = 6;
export function feedRequestIndex(firstPageCount) {
  const n = Number(firstPageCount) || 0;
  if (n <= 0) return -1;
  return Math.min(FEED_REQUEST_AFTER, n) - 1;
}

/**
 * A fixed-window counter per key. In process — the web app is one PM2 fork
 * (web/CLAUDE.md), the same assumption lib/eventIngest.js makes. A speed bump
 * against someone filling the form in a loop, not a defence against a
 * distributed one.
 */
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return function limited(key, now = Date.now()) {
    const cutoff = now - windowMs;
    for (const [k, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
    const recent = hits.get(key) || [];
    if (recent.length >= max) return true;
    recent.push(now);
    hits.set(key, recent);
    return false;
  };
}
