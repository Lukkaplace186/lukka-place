import 'server-only';
import { agentBrandFields, frenchTypeText, getFlyerListing } from '../listingFlyer';
import { agentContactPhone, shareBlocker } from '../listingShareCopy';
import { buildPrintSheet } from './printSheet';
import { getPrintExtras, qrSvg } from './printSheetData';

/**
 * Everything the window poster and the technical sheet
 * (app/compte/agent/biens/[id]/affiche, …/fiche) print. Ownership is
 * getFlyerListing's `p.agent_id = $3`.
 */

/**
 * @returns {Promise<null | {blocker: string|null, phoneHidden: boolean, sheet: object|null, qr: string|null}>}
 *   null when the listing is not the agent's own (the page 404s). A blocked
 *   listing (pending, archived, under offer, closed) gets no sheet: its QR
 *   code would point at a page that 404s or invites enquiries nobody can
 *   honour — the same shareBlocker the share kit uses.
 */
export async function getPrintSheetData(agentId, propertyId, medium) {
  const listing = await getFlyerListing(agentId, propertyId);
  if (!listing) return null;
  const blocker = shareBlocker(listing);
  const phoneHidden = Boolean(listing.agent_phone_raw) && !agentContactPhone(listing);
  if (blocker) return { blocker, phoneHidden, sheet: null, qr: null };

  const extras = await getPrintExtras(agentId, listing.id);
  let supabaseHost = null;
  try {
    supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    supabaseHost = null;
  }
  const sheet = buildPrintSheet(listing, extras, {
    typeText: frenchTypeText(listing),
    brand: agentBrandFields(listing),
    supabaseHost,
    medium,
  });
  return { blocker: null, phoneHidden, sheet, qr: await qrSvg(sheet.url) };
}
