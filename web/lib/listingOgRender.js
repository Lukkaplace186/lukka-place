import 'server-only';
import { ImageResponse } from 'next/og';
import { getListingById } from './listings';
import { listingImages } from './listingView';
import { createTranslator } from './i18n/translate';
import fr from './i18n/fr.json';
import { OG_PHOTO_BLOCK, ogCardModel } from './listingOgCard';
import {
  OG_SCALES, encodeOgCard, loadOgFonts, loadOgPhotos, loadOgRoyalLogo, loadOgSerif, loadOgWordmark,
} from './listingOgImage';
import { LINE_ICONS } from './marketing/icons';

/**
 * The listing link preview card (the Éditorial design), drawn and kept.
 * app/(site)/listings/[id]/opengraph-image.js serves it; the share dialogs
 * (app/admin/listings/shareActions.js, app/compte/agent/shareActions.js) WARM
 * it as soon as they open, before anyone posts the link.
 *
 * WHY THE CACHE (2026-11-06): drawn at 2×, a card took 6–7 s — photos
 * fetched and ranked, then one or two renderings until a size fits the
 * budget — on every request, cached nowhere. Facebook's crawler gave up
 * first and a group post showed an empty grey box. The finished JPEG is now
 * kept in memory per listing VERSION (price, title, photos, verification,
 * updated_at), so a crawler is answered at once and a change to the listing
 * draws a new card.
 */

const BASE = { width: 1200, height: 630 };

const frT = createTranslator({ locale: 'fr', messages: fr });

const IVORY = '#F7F6F2';
const INK = '#0B1B3F';
const ROYAL = '#144FC5';
const MUTED = '#4A5468';
const RULE = '#D6D9E0';
const COLUMN_LEFT = OG_PHOTO_BLOCK.width + OG_PHOTO_BLOCK.gap;
// The logo file is 2354×746.
const LOGO_HEIGHT = 48;
const LOGO_WIDTH = Math.round((2354 / 746) * LOGO_HEIGHT);

function Icon({ name, size: px, color, strokeWidth = 2 }) {
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {LINE_ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Every length is written on the 1200×630 grid and multiplied by the scale
 * the card is drawn at (`s`), so text, logo and rules are rendered at the
 * final pixel size. A CSS transform on a wrapper was tried first: satori
 * scaled the text but not the absolutely placed photos and logo.
 */
function PhotoBlock({ photos, wordmark, s }) {
  if (!photos.length) {
    return (
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: s(OG_PHOTO_BLOCK.width), height: s(OG_PHOTO_BLOCK.height),
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: ROYAL,
        }}
      >
        {wordmark ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
          <img src={wordmark} width={s(360)} height={s(114)} style={{ width: s(360), height: s(114) }} />
        ) : (
          <div style={{ display: 'flex', fontSize: s(64), fontWeight: 800, color: '#FFFFFF' }}>Lukka Place</div>
        )}
      </div>
    );
  }
  return (
    <>
      {photos.map((photo) => (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
        <img
          key={`${photo.left}-${photo.top}`}
          src={photo.src}
          width={s(photo.width)}
          height={s(photo.height)}
          style={{ position: 'absolute', left: s(photo.left), top: s(photo.top), width: s(photo.width), height: s(photo.height) }}
        />
      ))}
    </>
  );
}

function OgCard({ model, photos, wordmark, royalLogo, serif, scale }) {
  const s = (n) => n * scale;
  const priceFont = serif ? 'Serif' : 'Jakarta';
  const hasFacts = Boolean(model.typeText || model.roomsLine);
  return (
    <div
      style={{
        width: s(BASE.width), height: s(BASE.height), display: 'flex', position: 'relative', overflow: 'hidden',
        background: IVORY, color: INK, fontFamily: 'Jakarta',
      }}
    >
      <PhotoBlock photos={photos} wordmark={wordmark} s={s} />

      <div
        style={{
          position: 'absolute', left: s(COLUMN_LEFT), top: 0, width: s(BASE.width - COLUMN_LEFT), height: s(BASE.height),
          paddingTop: s(54), paddingRight: s(54), paddingBottom: s(50), paddingLeft: s(50),
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', fontSize: s(17), fontWeight: 700, letterSpacing: s(3.7), lineHeight: 1.2, color: ROYAL }}>
          {model.line || ' '}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex', fontFamily: priceFont, fontWeight: serif ? 400 : 800, fontSize: s(model.priceSize),
              lineHeight: 0.92, letterSpacing: s(-0.025 * model.priceSize), color: INK,
            }}
          >
            {model.amount}
          </div>
          {model.periodWords ? (
            <div style={{ display: 'flex', marginTop: s(12), fontSize: s(21), fontWeight: 500, color: MUTED }}>{model.periodWords}</div>
          ) : null}
          {hasFacts ? <div style={{ display: 'flex', height: s(1), background: RULE, marginTop: s(30), marginBottom: s(22) }} /> : null}
          {model.typeText ? (
            <div style={{ display: 'flex', fontSize: s(22), fontWeight: 700, color: INK }}>{model.typeText}</div>
          ) : null}
          {model.roomsLine ? (
            <div style={{ display: 'flex', marginTop: model.typeText ? s(6) : 0, fontSize: s(21), fontWeight: 500, lineHeight: 1.3, color: MUTED }}>
              {model.roomsLine}
            </div>
          ) : null}
          {model.verified ? (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: s(14), fontSize: s(17), fontWeight: 700, color: ROYAL }}>
              <Icon name="badgeCheck" size={s(20)} color={ROYAL} />
              <div style={{ display: 'flex', marginLeft: s(8) }}>Vérifié par Lukka Place</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          {royalLogo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
            <img src={royalLogo} width={s(LOGO_WIDTH)} height={s(LOGO_HEIGHT)} style={{ width: s(LOGO_WIDTH), height: s(LOGO_HEIGHT) }} />
          ) : (
            <div style={{ display: 'flex', fontSize: s(30), fontWeight: 800, color: ROYAL }}>Lukka Place</div>
          )}
          <div style={{ display: 'flex', fontSize: s(18), fontWeight: 600, lineHeight: 1, paddingBottom: s(3), color: MUTED }}>lukkaplace.com</div>
        </div>
      </div>
    </div>
  );
}


/** Finished cards: key → { body, type, scale, quality, at }. */
const cache = new Map();
const inflight = new Map();
export const OG_CACHE_MAX = 120;
export const OG_CACHE_TTL_MS = 6 * 3600 * 1000;

/** What makes a card different: everything it draws. */
export function ogCacheKey(listing) {
  return [
    listing.id, listing.updated_at, listing.price, listing.price_period, listing.purpose, listing.title,
    listing.verified_at, listing.commune, listing.beds, listing.bath, listing.area, listingImages(listing).join(','),
  ].map((v) => (v instanceof Date ? v.toISOString() : v ?? '')).join('|');
}

async function draw(listing) {
  const model = ogCardModel(listing, frT);
  const [fonts, serif, photos, wordmark, royalLogo] = await Promise.all([
    loadOgFonts(),
    loadOgSerif(),
    // Cropped once at the largest scale; a smaller rendering scales them down.
    loadOgPhotos(listingImages(listing), { scale: OG_SCALES[0] }),
    loadOgWordmark(),
    loadOgRoyalLogo(),
  ]);
  const allFonts = [...fonts, ...serif];
  return encodeOgCard((at) => new ImageResponse(
    <OgCard model={model} photos={photos} wordmark={wordmark} royalLogo={royalLogo} serif={serif.length > 0} scale={at} />,
    { width: BASE.width * at, height: BASE.height * at, ...(allFonts.length ? { fonts: allFonts } : {}) },
  ).arrayBuffer());
}

/**
 * The card for a PUBLIC listing row (lib/listings.js getListingById), from
 * the cache when this version was drawn in the last OG_CACHE_TTL_MS. Two
 * requests for the same version at once share one drawing.
 *
 * @returns {Promise<{body: Buffer|ArrayBuffer, type: string, scale: number, quality: number|null, cached: boolean}>}
 */
export async function renderListingOgCard(listing) {
  const key = ogCacheKey(listing);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < OG_CACHE_TTL_MS) return { ...hit, cached: true };
  if (inflight.has(key)) return { ...(await inflight.get(key)), cached: false };
  const job = draw(listing)
    .then((result) => {
      const entry = { ...result, at: Date.now() };
      // One entry per listing: an older version of it is dropped.
      for (const k of cache.keys()) if (k.startsWith(`${listing.id}|`)) cache.delete(k);
      cache.set(key, entry);
      while (cache.size > OG_CACHE_MAX) cache.delete(cache.keys().next().value);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return { ...(await job), cached: false };
}

/**
 * Draws a listing's card ahead of time (the share dialogs, when they open).
 * Fire-and-forget: never throws, and does nothing for a listing that is not
 * public (getListingById applies the public gate).
 */
export function warmListingOgCard(listingId) {
  prepareListingOgCard(listingId);
}

/**
 * The same, awaitable: the share dialogs' "read the link now" step waits for
 * it BEFORE asking Facebook to fetch the page, so Facebook's crawler finds the
 * card already drawn. Resolves to true when a card is ready; never rejects.
 */
export async function prepareListingOgCard(listingId) {
  try {
    const listing = await getListingById(listingId);
    if (!listing) return false;
    await renderListingOgCard(listing);
    return true;
  } catch (err) {
    console.error(`[og-image] preparing listing ${listingId} failed: ${err.message}`);
    return false;
  }
}
