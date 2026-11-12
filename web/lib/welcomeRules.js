/**
 * The app's first-open questions (UX pass 2026-11-12): "Louer ou acheter ?",
 * "Votre budget ?", "Quelles communes ?" — each answered with taps. The
 * answers become an ordinary /listings search (same parameters as the search
 * card, lib/searchQuery.js), kept on the device as the first saved search.
 * Pure: the page and the tests share it.
 */

/** Set once the questions are answered or skipped; GET /app then opens on the home. */
export const WELCOME_COOKIE = 'lp_welcome';
export const WELCOME_MAX_AGE = 60 * 60 * 24 * 365 * 2;

export const WELCOME_PURPOSES = Object.freeze([
  { value: 'louer', labelKey: 'appShell.welcome.purposes.louer' },
  { value: 'acheter', labelKey: 'appShell.welcome.purposes.acheter' },
  { value: 'courte', labelKey: 'appShell.welcome.purposes.courte' },
]);

/** Ceilings offered per purpose; null = "Peu importe". Short stays have no budget step. */
const BUDGETS = {
  louer: [300, 500, 800, 1500, null],
  acheter: [50000, 100000, 250000, 500000, null],
  courte: [],
};

/** "1 500 $": French grouping with a no-break space, the dollar after, as on every price. */
export function formatWelcomeBudget(value) {
  const grouped = String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped} $`;
}

export function budgetChoices(purpose) {
  return BUDGETS[purpose] ? [...BUDGETS[purpose]] : [];
}

export const MAX_WELCOME_COMMUNES = 3;

/** Toggle a commune in the picked list, at most MAX_WELCOME_COMMUNES, order kept. */
export function toggleCommune(picked, name) {
  const list = Array.isArray(picked) ? picked : [];
  if (list.includes(name)) return list.filter((c) => c !== name);
  if (list.length >= MAX_WELCOME_COMMUNES) return list;
  return [...list, name];
}

/**
 * The /listings query for the answers: transaction_type (location / vente),
 * lease_term=short for Courte durée, price_max, and the communes the way the
 * search card writes several (commune = the first, communes = all of them).
 */
export function welcomeSearchQuery({ purpose, budget = null, communes = [] } = {}) {
  const qs = new URLSearchParams();
  if (purpose === 'acheter') qs.set('transaction_type', 'vente');
  else if (purpose === 'louer' || purpose === 'courte') qs.set('transaction_type', 'location');
  if (purpose === 'courte') qs.set('lease_term', 'short');
  if (budget != null && Number(budget) > 0 && purpose !== 'courte') qs.set('price_max', String(Number(budget)));
  const picked = (Array.isArray(communes) ? communes : []).filter(Boolean).slice(0, MAX_WELCOME_COMMUNES);
  if (picked.length) qs.set('commune', picked[0]);
  if (picked.length > 1) qs.set('communes', picked.join(','));
  return qs.toString();
}

/** Where GET /app sends someone: the questions until they are answered or skipped. */
export function appStartTarget({ isAgent, welcomed }) {
  if (isAgent) return '/compte/agent';
  return welcomed ? '/' : '/bienvenue';
}
