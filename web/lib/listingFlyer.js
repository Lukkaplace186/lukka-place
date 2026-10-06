import 'server-only';
import { getPool } from './db';
import { typeLabel } from './listingView';
import { createTranslator } from './i18n/translate';
import { AGENCY_NAME_EXPR, AGENT_INFOS_JOIN } from './listings';
import { displayableAgencyName } from './agentIdentity';
import { agentContactPhone } from './listingShareCopy';
import { isVerifiedLevel } from './verificationLevels';
import fr from './i18n/fr.json';

/**
 * The rows and brand fields behind the agent's listing graphics and captions
 * (app/compte/agent/shareActions.js → the share pack the browser draws from,
 * lib/marketing/sharePackData.js; the print pages; the "!share" command). The
 * server-drawn flyer that used to live at /compte/agent/biens/:id/visuel was
 * retired on 2026-10-06 with the card redesign: the browser renderer is the
 * only one, so there is one design to keep right.
 *
 * Ownership is in the SQL: `p.agent_id = $3`, the same rule lib/agentListings.js
 * applies to every statement, so a guessed listing id returns nothing rather
 * than another agency's flyer.
 */

const CONTENT_LANGUAGE_ID = 20;
const CATEGORY_LANGUAGE_ID = 26;

const FLYER_SELECT = `SELECT p.id, p.price, p.purpose, p.price_period, p.beds, p.bath, p.area, p.units_count,
            p.quartier, p.parcelle_subtype, p.reference, p.deposit_months, p.advance_months,
            p.commission_months, p.featured_image, p.status, p.approve_status, p.listing_status,
            pc.title, catc.name AS category_name,
            -- The agent's own brand for the flyer's logo slot. The phone is
            -- only printed under the same rule the public listing page uses
            -- (verified AND direct routing not switched off by the team).
            a.image AS agent_image, a.phone AS agent_phone_raw, a.phone_verified_at AS agent_phone_verified_at,
            a.direct_routing_enabled AS agent_direct_routing_enabled,
            -- The reviewed-documents tier behind the gold badge. Through jsonb
            -- for the same reason lib/listings.js reads it that way.
            to_jsonb(a) ->> 'verification_level' AS agent_verification_level,
            ${AGENCY_NAME_EXPR},
            (
              SELECT ac.name FROM property_amenities pa
              JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
              WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
              LIMIT 1
            ) AS commune,
            (
              SELECT COALESCE(array_agg(psi.image ORDER BY psi.id), ARRAY[]::text[])
              FROM property_slider_images psi WHERE psi.property_id = p.id
            ) AS gallery
     FROM properties p
     JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
     LEFT JOIN property_category_contents catc ON catc.category_id = p.category_id AND catc.language_id = $4
     LEFT JOIN agents a ON a.id = p.agent_id
     ${AGENT_INFOS_JOIN}`;

export async function getFlyerListing(agentId, propertyId) {
  if (!Number.isFinite(Number(agentId)) || !Number.isFinite(Number(propertyId))) return null;
  const { rows } = await getPool().query(
    `${FLYER_SELECT}
     WHERE p.id = $2 AND p.agent_id = $3`,
    [CONTENT_LANGUAGE_ID, Number(propertyId), Number(agentId), CATEGORY_LANGUAGE_ID],
  );
  return rows[0] || null;
}

/**
 * The same rows for several of the agent's own listings in ONE query (Mes
 * biens' direct WhatsApp buttons). Same ownership clause; an id that is not
 * theirs simply returns no row.
 */
export async function getFlyerListings(agentId, propertyIds) {
  const ids = [...new Set((propertyIds || []).map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (!Number.isFinite(Number(agentId)) || !ids.length) return [];
  const { rows } = await getPool().query(
    `${FLYER_SELECT}
     WHERE p.id = ANY($2::bigint[]) AND p.agent_id = $3`,
    [CONTENT_LANGUAGE_ID, ids, Number(agentId), CATEGORY_LANGUAGE_ID],
  );
  return rows;
}

/** French, always — see lib/listingShareCopy.js for why the market language wins. */
const frT = createTranslator({ locale: 'fr', messages: fr });

export function frenchTypeText(listing) {
  return typeLabel(listing, frT);
}

// ---------------------------------------------------------------------------
// Agent brand
// ---------------------------------------------------------------------------

/**
 * What goes in the card's brand block: the agent's logo (or profile photo),
 * their name, and their phone.
 *
 * This slot held a QR code. It was dropped on an explicit product decision:
 * the flyer goes out on the agent's WhatsApp Status with the listing link in
 * the caption right under it, so the QR was a second, worse route to the same
 * page — and the space is worth more as the agent's own marketing.
 *
 * Nothing is invented. No logo means the agent's initials on a white card; no
 * name means no brand block at all rather than a Lukka Place mark passed off
 * as theirs. The phone appears only under the rule the public listing page
 * already applies — verified, and direct routing not switched off by the team
 * (lib/listings.js) — so the flyer can never publish a number the site itself
 * refuses to show.
 *
 * THE GOLD BADGE IS EARNED, NOT DECORATION. It renders only for an agent whose
 * documents a team member actually approved — `agents.verification_level` of
 * 'verified' or 'agency_partner', set from /admin/verifications. A 'standard'
 * agent gets no badge at all rather than an unbacked trust mark, which is the
 * whole reason the badge is worth anything to the agents who do hold it.
 *
 */
const BADGE_LABELS = { verified: 'Agent vérifié', agency_partner: 'Agence partenaire' };

/**
 * The brand block's text fields, with no fetch. The share pack
 * (lib/marketing/sharePackData.js) sends the logo's URL beside them.
 *
 * @returns {{name: string|null, initials: string|null, phone: string|null, badge: string|null}}
 */
export function agentBrandFields(listing) {
  const name = displayableAgencyName(listing?.agency_name);
  const initials =
    (name || '')
      .split(/\s+/)
      .filter((part) => /^[A-Za-zÀ-ÿ]/.test(part))
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || null;

  const phone = agentContactPhone(listing);
  const level = listing?.agent_verification_level;
  const badge = isVerifiedLevel(level) ? BADGE_LABELS[level] : null;
  return { name, initials, phone, badge };
}

// ---------------------------------------------------------------------------
// The Lukka Place mark
// ---------------------------------------------------------------------------

/**
 * The roofline chevron from the supplied logo (components/Brand.js), as
 * same-origin paths the share pack hands the browser renderer: the white cut
 * for a blue ground, and the blue + green cut for the listing card's white
 * contact bar (lib/marketing/layout.js).
 */
export const PLATFORM_MARK_PATH = '/brand/icon-dark.png';
export const PLATFORM_MARK_LIGHT_PATH = '/brand/icon-light.png';
