'use client';

/**
 * The visitor's USD/CDF display preference — same localStorage +
 * same-window CustomEvent pattern as lib/favorites.js (not a React
 * Context), for consistency with the one existing local-persistence
 * convention in this codebase. Purely a display toggle: it never changes
 * what's actually stored or sent (see components/Price.js and
 * lib/whatsapp.js's doc comments).
 */

const CURRENCY_KEY = 'lukka_currency';
const CURRENCY_EVENT = 'lukka:currency-changed';
const DEFAULT_CURRENCY = 'USD';

export function getCurrency() {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY;
  const value = window.localStorage.getItem(CURRENCY_KEY);
  return value === 'CDF' ? 'CDF' : DEFAULT_CURRENCY;
}

export function setCurrency(value) {
  const next = value === 'CDF' ? 'CDF' : 'USD';
  window.localStorage.setItem(CURRENCY_KEY, next);
  window.dispatchEvent(new CustomEvent(CURRENCY_EVENT));
}

export function subscribeCurrency(callback) {
  window.addEventListener(CURRENCY_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(CURRENCY_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}
