import { ImageResponse } from 'next/og';
import { getListingById } from '@/lib/listings';
import { listingImages } from '@/lib/listingView';
import { createTranslator } from '@/lib/i18n/translate';
import fr from '@/lib/i18n/fr.json';
import { OG_PHOTO_BLOCK, ogCardModel } from '@/lib/listingOgCard';
import {
  OG_SCALES, encodeOgCard, loadOgFonts, loadOgPhotos, loadOgRoyalLogo, loadOgSerif, loadOgWordmark,
} from '@/lib/listingOgImage';
import { LINE_ICONS } from '@/lib/marketing/icons';

/**
 * The listing's link preview — what WhatsApp, Facebook and X show when its
 * URL is pasted. Next adds og:image / og:image:width / height / type to the
 * listing page's <head> from this file, ahead of anything generateMetadata
 * says; twitter-image.js beside it serves the same card as twitter:image.
 *
 * THE "ÉDITORIAL" CARD (2026-11-06, design canvas "Aperçu lien prestige",
 * chosen by the owner over a dark full-photo card that read as a template):
 * the listing's three brightest photos on the left — one tall, two stacked,
 * separated by thin gaps of the same ivory as the column — and an ivory
 * column on the right with "À LOUER · GOMBE" in royal blue, the price in the
 * serif, "par mois", a rule, the type and the room counts in words, and the
 * one-colour royal logo with lukkaplace.com at the foot. No dark veil over
 * the photos, no icons on the facts, no button: Facebook prints the link's
 * title and domain under the image already.
 *
 * Photos: agents upload in any order, so the card does not take the first
 * three — lib/listingOgImage.js loadOgPhotos ranks the listing's own photos
 * by brightness and drops duplicates. Two photos sit side by side, one fills
 * the block, none draws the blue block with the white logo (never a stand-in
 * photo). The old centre-square constraint is gone: WhatsApp's square
 * thumbnail is ~100px and prints the title beside it.
 *
 * What the card says is lib/listingOgCard.js (pure, tested). Same public gate
 * as the page (getListingById): a pending, rejected or archived listing
 * answers 404, never a preview of it.
 *
 * Always French: a crawler sends no locale cookie, and the people the link is
 * sent to read the market's language. Cached 10 minutes, so a price change
 * reaches a NEW share quickly; WhatsApp and Facebook keep their own copy of a
 * preview they already fetched.
 */

export const alt = 'Annonce Lukka Place : photos, prix et caractéristiques du bien';
// Laid out on a 1200×630 grid, DRAWN at 2× (lib/listingOgImage.js OG_SCALES):
// Facebook shows the preview on 2–3× phone screens, and a 1200px image was
// being enlarged there, blurring the text. A listing whose photos make the 2×
// file too heavy for WhatsApp is drawn at 1.5× or 1× instead (same 1.91:1).
export const size = { width: 2400, height: 1260 };
const BASE = { width: 1200, height: 630 };
export const contentType = 'image/jpeg';
export const revalidate = 600;

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

export default async function Image({ params }) {
  const { id } = await params;
  const listing = await getListingById(id);
  if (!listing) return new Response('Not found', { status: 404 });

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
  const { body, type, scale, quality } = await encodeOgCard((at) => new ImageResponse(
    <OgCard model={model} photos={photos} wordmark={wordmark} royalLogo={royalLogo} serif={serif.length > 0} scale={at} />,
    { width: BASE.width * at, height: BASE.height * at, ...(allFonts.length ? { fonts: allFonts } : {}) },
  ).arrayBuffer());

  return new Response(body, {
    headers: {
      'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400',
      'Content-Type': type,
      'X-Og-Scale': `${scale}x q${quality ?? 'png'}`,
    },
  });
}
