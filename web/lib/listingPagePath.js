/**
 * Is this pathname a listing's own page (/listings/1124-slug, /en/listings/…)?
 * The site-wide pieces that stay off it (2026-11-18, owner: a shorter, calmer
 * listing page): the "Mes visites" pill (VisitCartSheet) and the footer's
 * "Vous êtes agent ou agence ?" band (Footer). Pure, for tests.
 */
export function isListingPagePath(pathname) {
  return /^\/(?:[a-z]{2}\/)?listings\/\d+(?:[-/]|$)/.test(String(pathname || ''));
}
