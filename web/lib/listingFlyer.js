import 'server-only';
import { getPool } from './db';
import { listingImages, typeLabel, usableImageSrc } from './listingView';
import { NO_PHOTO_URL, SITE_URL } from './constants';
import { createTranslator } from './i18n/translate';
import { sniffDocumentType } from './verificationLevels';
import { AGENCY_NAME_EXPR, AGENT_INFOS_JOIN } from './listings';
import { displayableAgencyName } from './agentIdentity';
import { formatPhoneDisplay } from './phone';
import fr from './i18n/fr.json';

/**
 * Data and assets for the agent's square social graphic
 * (app/compte/agent/biens/[id]/visuel/route.js).
 *
 * Ownership is in the SQL: `p.agent_id = $3`, the same rule lib/agentListings.js
 * applies to every statement, so a guessed listing id returns nothing rather
 * than another agency's flyer.
 */

const CONTENT_LANGUAGE_ID = 20;
const CATEGORY_LANGUAGE_ID = 26;

export async function getFlyerListing(agentId, propertyId) {
  if (!Number.isFinite(Number(agentId)) || !Number.isFinite(Number(propertyId))) return null;
  const { rows } = await getPool().query(
    `SELECT p.id, p.price, p.purpose, p.price_period, p.beds, p.bath, p.area, p.units_count,
            p.quartier, p.parcelle_subtype, p.reference, p.deposit_months, p.advance_months,
            p.commission_months, p.featured_image, p.status, p.approve_status, p.listing_status,
            pc.title, catc.name AS category_name,
            -- The agent's own brand for the flyer's logo slot. The phone is
            -- only printed under the same rule the public listing page uses
            -- (verified AND direct routing not switched off by the team).
            a.image AS agent_image, a.phone AS agent_phone_raw, a.phone_verified_at AS agent_phone_verified_at,
            a.direct_routing_enabled AS agent_direct_routing_enabled, ${AGENCY_NAME_EXPR},
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
     ${AGENT_INFOS_JOIN}
     WHERE p.id = $2 AND p.agent_id = $3`,
    [CONTENT_LANGUAGE_ID, Number(propertyId), Number(agentId), CATEGORY_LANGUAGE_ID],
  );
  return rows[0] || null;
}

/** French, always — see lib/listingShareCopy.js for why the market language wins. */
const frT = createTranslator({ locale: 'fr', messages: fr });

export function frenchTypeText(listing) {
  return typeLabel(listing, frT);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * Only our own storage hosts. The URLs come from our own write paths, but the
 * server is about to fetch whatever the row says, and a row is not a place a
 * server should take an arbitrary URL from.
 */
function allowedPhotoHosts() {
  const hosts = new Set(['lukkaplace.com', 'www.lukkaplace.com']);
  try {
    if (process.env.SUPABASE_URL) hosts.add(new URL(process.env.SUPABASE_URL).host);
  } catch {
    // A malformed SUPABASE_URL just means no Supabase photos on the flyer.
  }
  return hosts;
}

/**
 * JPEG and PNG only, identified by magic bytes (the same sniffer verification
 * uploads use). The flyer renderer (satori, behind next/og) decodes those
 * reliably; anything else — including a 200 HTML error page — is skipped
 * rather than risking a broken tile. Every stored photo checked in production
 * is .jpg or .png.
 */
const FLYER_IMAGE_TYPES = ['image/jpeg', 'image/png'];

function flyerImageType(buffer) {
  const kind = sniffDocumentType(buffer.subarray(0, 16));
  return kind && FLYER_IMAGE_TYPES.includes(kind.mime) ? kind.mime : null;
}

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * sharp ships with Next (the image optimiser uses it) and is present in both
 * deployed web directories. It buys three things the flyer needs:
 * WebP → PNG/JPEG (satori decodes neither WebP nor AVIF), EXIF rotation (a
 * phone photo otherwise renders on its side — satori ignores orientation),
 * and a resize, so three 8 MB photos don't become a 30 MB base64 payload.
 *
 * It is optional: if the import fails, a JPEG or PNG still renders as it was
 * downloaded and anything else is skipped.
 */
async function normaliseImage(buffer, { maxWidth, transparent = false }) {
  try {
    const { default: sharp } = await import('sharp');
    const pipeline = sharp(buffer).rotate().resize({ width: maxWidth, withoutEnlargement: true });
    const out = transparent ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 82 }).toBuffer();
    return `data:${transparent ? 'image/png' : 'image/jpeg'};base64,${out.toString('base64')}`;
  } catch {
    const type = flyerImageType(buffer);
    return type ? `data:${type};base64,${buffer.toString('base64')}` : null;
  }
}

async function fetchImageBuffer(src, hosts) {
  let url;
  try {
    url = new URL(src, SITE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !hosts.has(url.host)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length > MAX_PHOTO_BYTES ? null : buffer;
  } catch {
    return null;
  }
}

async function fetchPhotoDataUri(src, hosts) {
  const buffer = await fetchImageBuffer(src, hosts);
  return buffer ? normaliseImage(buffer, { maxWidth: 1080 }) : null;
}

/**
 * Up to three real photos, cover first. Fewer is fine and the layout adapts;
 * zero renders a branded panel — never a stock photo standing in for a
 * property nobody photographed.
 */
export async function loadFlyerPhotos(listing, max = 3) {
  const hosts = allowedPhotoHosts();
  const candidates = listingImages(listing).filter((src) => src !== NO_PHOTO_URL).slice(0, max + 3);
  const results = await Promise.all(candidates.map((src) => fetchPhotoDataUri(src, hosts)));
  return results.filter(Boolean).slice(0, max);
}

// ---------------------------------------------------------------------------
// The agent's own brand
// ---------------------------------------------------------------------------

/**
 * What goes in the flyer's brand block: the agent's logo (or profile photo),
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
 * @returns {Promise<{logo: string|null, name: string|null, initials: string|null, phone: string|null}>}
 */
export async function loadAgentBrand(listing) {
  const name = displayableAgencyName(listing?.agency_name);
  const initials =
    (name || '')
      .split(/\s+/)
      .filter((part) => /^[A-Za-zÀ-ÿ]/.test(part))
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || null;

  const routable =
    listing?.agent_phone_verified_at && listing?.agent_direct_routing_enabled !== false;
  const phone = routable ? formatPhoneDisplay(String(listing.agent_phone_raw || '').trim()) : null;

  let logo = null;
  if (usableImageSrc(listing?.agent_image)) {
    const buffer = await fetchImageBuffer(listing.agent_image, allowedPhotoHosts());
    // PNG, not JPEG: a logo with a transparent background must keep it, or it
    // renders on a black box inside its white card.
    if (buffer) logo = await normaliseImage(buffer, { maxWidth: 400, transparent: true });
  }

  return { logo, name, initials, phone };
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * Plus Jakarta Sans — the storefront's UI face — in the two weights the flyer
 * uses, fetched once per process from Google Fonts (OFL) and kept in memory.
 * next/font only ships woff2 into the client bundle, which satori cannot read,
 * so the TrueType files are requested directly; Google serves TTF to a client
 * that does not claim to be a modern browser.
 *
 * A failed fetch resolves to [] and the flyer renders in next/og's bundled
 * default face. A slightly plainer graphic beats no graphic.
 */
let fontsPromise = null;

export function loadFlyerFonts() {
  if (!fontsPromise) {
    fontsPromise = fetchJakarta().catch((err) => {
      console.error(`[flyer] font fetch failed, using default face: ${err.message}`);
      fontsPromise = null; // retry on a later request
      return [];
    });
  }
  return fontsPromise;
}

async function fetchJakarta() {
  const cssRes = await fetch('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;800', {
    headers: { 'User-Agent': 'Mozilla/4.0' },
    signal: AbortSignal.timeout(5000),
  });
  if (!cssRes.ok) throw new Error(`css ${cssRes.status}`);
  const css = await cssRes.text();

  const faces = [...css.matchAll(/font-weight:\s*(\d+);[\s\S]*?src:\s*url\(([^)]+)\)/g)];
  const wanted = new Map(faces.map(([, weight, src]) => [Number(weight), src]));
  const fonts = [];
  for (const weight of [500, 800]) {
    const src = wanted.get(weight);
    if (!src) continue;
    const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) continue;
    fonts.push({ name: 'Jakarta', data: await res.arrayBuffer(), weight, style: 'normal' });
  }
  if (!fonts.length) throw new Error('no TrueType faces in the stylesheet');
  return fonts;
}
