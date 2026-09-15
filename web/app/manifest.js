/**
 * Web app manifest — what makes "Ajouter à l'écran d'accueil" install
 * Lukka Place as an app on Android, with its own icon and no browser chrome.
 *
 * Agents open the dashboard many times a day from the same phone; an icon on
 * the home screen is one tap instead of typing the URL on a slow keyboard.
 * The icons are the same solid-blue tile as app/icon.png (192 is a resize of
 * it, public/brand/icon-192.png), not a new mark.
 *
 * French only on purpose: a manifest has no locale negotiation, and French is
 * the site's default language (lib/i18n/config.js).
 */
export default function manifest() {
  return {
    id: '/',
    name: 'Lukka Place — Immobilier à Kinshasa',
    short_name: 'Lukka Place',
    description: 'Location et vente de maisons, appartements et parcelles à Kinshasa.',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FBF9F6',
    theme_color: '#1D5BD8',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
