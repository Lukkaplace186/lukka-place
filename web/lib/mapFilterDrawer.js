/**
 * Lets the mobile fullscreen map's floating "Filtres" button open the same
 * FilterModal FilterBar.js already owns, without lifting that open state
 * through app/(site)/listings/page.js — which can't hold client state, it's
 * an async Server Component. A plain window CustomEvent, same idea as
 * lib/searchHistory.js's write-then-broadcast pattern already used for
 * cross-component sync in this app: one real, shared piece of UI state
 * (FilterBar's mobile filter sheet), reached from two triggers.
 *
 * Opens FilterModal specifically, not FiltersDrawer — map view is always a
 * mobile-only context (MobileMapChrome is `lg:hidden`), and FilterModal is
 * the comprehensive mobile sheet (Prix/Chambres/Salles de bain/Type de bien
 * plus everything FiltersDrawer has); FiltersDrawer alone doesn't cover
 * Prix or Type de bien at all, which used to leave map view with no way to
 * set either without switching back to list view first.
 */
const EVENT_NAME = 'lukka:open-filters-drawer';

export function openFiltersDrawer() {
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function subscribeOpenFiltersDrawer(handler) {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
