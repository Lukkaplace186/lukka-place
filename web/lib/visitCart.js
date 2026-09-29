import { VISIT_CART_MAX } from './visitSlots';

/**
 * "Mes visites": up to VISIT_CART_MAX listings a visitor wants to see, kept in
 * this browser only (localStorage, same posture as lib/localFavorites.js) until
 * they send them all in one request (components/VisitCartSheet.js →
 * submitVisitBatchAction). Only display facts are stored — the server re-reads
 * every listing under the public gate before anything is created.
 *
 * Every change dispatches VISIT_CART_EVENT so the pill, the sheet and the
 * listing page's button stay in step within a tab; `storage` covers other tabs.
 */

export const VISIT_CART_KEY = 'lukka_visit_cart';
export const VISIT_CART_EVENT = 'lukka:visit-cart';
export const OPEN_VISIT_CART_EVENT = 'lukka:open-visit-cart';

/** Pure: a cart array cleaned to what it may hold. */
export function normaliseCart(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = Number.parseInt(item?.id, 10);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: typeof item.title === 'string' ? item.title.slice(0, 160) : '',
      image: typeof item.image === 'string' ? item.image : null,
      place: typeof item.place === 'string' ? item.place.slice(0, 120) : '',
      priceLabel: typeof item.priceLabel === 'string' ? item.priceLabel.slice(0, 60) : '',
    });
    if (out.length >= VISIT_CART_MAX) break;
  }
  return out;
}

/** Pure: add one listing. `{cart, added: false, reason}` when full or already there. */
export function addToCart(cart, item) {
  const current = normaliseCart(cart);
  if (current.some((entry) => entry.id === Number(item?.id))) return { cart: current, added: false, reason: 'present' };
  if (current.length >= VISIT_CART_MAX) return { cart: current, added: false, reason: 'full' };
  const next = normaliseCart([...current, item]);
  return { cart: next, added: next.length > current.length, reason: next.length > current.length ? null : 'invalid' };
}

export function removeFromCart(cart, id) {
  return normaliseCart(cart).filter((entry) => entry.id !== Number(id));
}

export function readCart() {
  try {
    return normaliseCart(JSON.parse(window.localStorage.getItem(VISIT_CART_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function writeCart(cart) {
  const next = normaliseCart(cart);
  try {
    if (next.length) window.localStorage.setItem(VISIT_CART_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(VISIT_CART_KEY);
  } catch {
    // Private mode: the cart simply lasts as long as the page.
  }
  try {
    window.dispatchEvent(new CustomEvent(VISIT_CART_EVENT, { detail: next }));
  } catch {
    // Nothing listens on a browser this old.
  }
  return next;
}

// --- useSyncExternalStore plumbing (components/useVisitCart.js) ---------------

let cachedRaw = null;
let cachedCart = [];
const EMPTY = [];

/** A stable snapshot: the same array until localStorage actually changes. */
export function cartSnapshot() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(VISIT_CART_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedCart = normaliseCart(JSON.parse(raw || '[]'));
    } catch {
      cachedCart = [];
    }
  }
  return cachedCart;
}

export function serverCartSnapshot() {
  return EMPTY;
}

export function subscribeCart(callback) {
  window.addEventListener(VISIT_CART_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(VISIT_CART_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
