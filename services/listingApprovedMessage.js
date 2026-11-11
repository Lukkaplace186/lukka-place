'use strict';

/**
 * What an agent is told when their listing goes live — by the team
 * (routes/admin.js, moderation verdict) or by trusted auto-approval
 * (services/trustedAutoApprove.js). One wording for both.
 *
 * Owner decision 2026-11-11: the link takes the agent to THEIR OWN listings
 * (Mes biens, /compte/agent/biens — login first when signed out, then back),
 * not to the public listing page. The app push already opened the listing in
 * the agent's dashboard.
 */

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
const MES_BIENS_PATH = '/compte/agent/biens';
const MES_BIENS_URL = `${SITE_URL}${MES_BIENS_PATH}`;

/**
 * Approved templates whose registered button is the DYNAMIC
 * https://lukkaplace.com/listings/{{1}} (the public page). They need the
 * listing id as the button parameter (#131008 without it). Any other name —
 * annonce_en_ligne_v3, a STATIC "Mes annonces" button to MES_BIENS_URL — must
 * get no button parameter at all.
 */
const APPROVED_TEMPLATES_WITH_LISTING_LINK = new Set(['annonce_en_ligne', 'annonce_en_ligne_v2']);

function listingApprovedText(propertyId) {
  return [
    `Bonjour, bonne nouvelle ! Votre annonce n° ${propertyId} est maintenant en ligne sur Lukka Place.`,
    `Retrouvez et gérez toutes vos annonces dans votre espace : ${MES_BIENS_URL}`,
  ].join('\n\n');
}

/** The template's button parameter: the listing id for a dynamic-link name, nothing otherwise. */
function approvedTemplateUrlButton(templateName, propertyId) {
  return APPROVED_TEMPLATES_WITH_LISTING_LINK.has(String(templateName || '').trim()) ? String(propertyId) : null;
}

module.exports = {
  MES_BIENS_PATH,
  MES_BIENS_URL,
  APPROVED_TEMPLATES_WITH_LISTING_LINK,
  listingApprovedText,
  approvedTemplateUrlButton,
};
