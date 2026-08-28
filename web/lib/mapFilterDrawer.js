/**
 * Lets the mobile fullscreen map's floating "Filtres" button open the same
 * FiltersDrawer FilterBar.js already owns, without lifting drawerOpen state
 * through app/(site)/listings/page.js — which can't hold client state, it's
 * an async Server Component. A plain window CustomEvent, same idea as
 * lib/searchHistory.js's write-then-broadcast pattern already used for
 * cross-component sync in this app: one real, shared piece of UI state
 * (FilterBar's drawer), reached from two triggers.
 */
const EVENT_NAME = 'lukka:open-filters-drawer';

export function openFiltersDrawer() {
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeOpenFiltersDrawer(handler) {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
