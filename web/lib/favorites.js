'use client';

/**
 * Favorites + saved searches — dispatches to localFavorites.js (anonymous,
 * localStorage) or accountFavorites.js (logged-in, server-synced via
 * /api/account/*) based on login state, behind one stable API surface so
 * FavoriteButton.js/SaveSearchButton.js/favoris/page.js never need to know
 * which backend is active.
 *
 * Safe to switch backends mid-session: loginAction/logoutAction always
 * `redirect()`, a full navigation that remounts the tree, so there's no
 * moment where a component holds a subscription to the "wrong" module.
 */
import { isLoggedInClient } from './customerClient';
import * as local from './localFavorites';
import * as account from './accountFavorites';

function active() {
  return isLoggedInClient() ? account : local;
}

export function getFavoriteIds() {
  return active().getFavoriteIds();
}

export function isFavorite(id) {
  return active().isFavorite(id);
}

export function toggleFavorite(id) {
  return active().toggleFavorite(id);
}

export function subscribeFavorites(callback) {
  return active().subscribeFavorites(callback);
}

export function getSavedSearches() {
  return active().getSavedSearches();
}

export function isSearchSaved(queryString) {
  return active().isSearchSaved(queryString);
}

export function saveSearch(search) {
  return active().saveSearch(search);
}

export function removeSavedSearch(queryString) {
  return active().removeSavedSearch(queryString);
}

export function subscribeSavedSearches(callback) {
  return active().subscribeSavedSearches(callback);
}
