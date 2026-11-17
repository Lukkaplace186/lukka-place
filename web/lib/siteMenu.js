/**
 * Open the site's menu drawer (components/Header.js) from elsewhere on the
 * page. Used by the phone map's liquid-glass header (MobileMapChrome), which
 * replaces the logo bar while the map is open (2026-11-17, owner: more room
 * for the map). A window event, so the map chrome needs no Header import.
 */
export const OPEN_SITE_MENU_EVENT = 'lkp:open-site-menu';

export function openSiteMenu() {
  window.dispatchEvent(new CustomEvent(OPEN_SITE_MENU_EVENT));
}
