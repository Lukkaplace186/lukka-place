import { ImageResponse } from 'next/og';
import { getListingById } from '@/lib/listings';
import { listingImages } from '@/lib/listingView';
import { createTranslator } from '@/lib/i18n/translate';
import fr from '@/lib/i18n/fr.json';
import { OG_PHOTO_BLOCK, ogCardModel } from '@/lib/listingOgCard';
import {
  loadOgFonts, loadOgPhotos, loadOgRoyalLogo, loadOgSerif, loadOgWordmark, pngToJpeg,
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
export const size = { width: 1200, height: 630 };
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

function PhotoBlock({ photos, wordmark }) {
  if (!photos.length) {
    return (
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: OG_PHOTO_BLOCK.width, height: OG_PHOTO_BLOCK.height,
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: ROYAL,
        }}
      >
        {wordmark ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
          <img src={wordmark} width={360} height={114} style={{ width: 360, height: 114 }} />
        ) : (
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 800, color: '#FFFFFF' }}>Lukka Place</div>
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
          width={photo.width}
          height={photo.height}
          style={{ position: 'absolute', left: photo.left, top: photo.top, width: photo.width, height: photo.height }}
        />
      ))}
    </>
  );
}

function OgCard({ model, photos, wordmark, royalLogo, serif }) {
  const priceFont = serif ? 'Serif' : 'Jakarta';
  const hasFacts = Boolean(model.typeText || model.roomsLine);
  return (
    <div
      style={{
        width: 1200, height: 630, display: 'flex', position: 'relative', overflow: 'hidden',
        background: IVORY, color: INK, fontFamily: 'Jakarta',
      }}
    >
      <PhotoBlock photos={photos} wordmark={wordmark} />

      <div
        style={{
          position: 'absolute', left: COLUMN_LEFT, top: 0, width: 1200 - COLUMN_LEFT, height: 630,
          padding: '54px 54px 50px 50px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', fontSize: 17, fontWeight: 700, letterSpacing: 3.7, lineHeight: 1.2, color: ROYAL }}>
          {model.line || ' '}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex', fontFamily: priceFont, fontWeight: serif ? 400 : 800, fontSize: model.priceSize,
              lineHeight: 0.92, letterSpacing: -0.025 * model.priceSize, color: INK,
            }}
          >
            {model.amount}
          </div>
          {model.periodWords ? (
            <div style={{ display: 'flex', marginTop: 12, fontSize: 21, fontWeight: 500, color: MUTED }}>{model.periodWords}</div>
          ) : null}
          {hasFacts ? <div style={{ display: 'flex', height: 1, background: RULE, marginTop: 30, marginBottom: 22 }} /> : null}
          {model.typeText ? (
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: INK }}>{model.typeText}</div>
          ) : null}
          {model.roomsLine ? (
            <div style={{ display: 'flex', marginTop: model.typeText ? 6 : 0, fontSize: 21, fontWeight: 500, lineHeight: 1.3, color: MUTED }}>
              {model.roomsLine}
            </div>
          ) : null}
          {model.verified ? (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 14, fontSize: 17, fontWeight: 700, color: ROYAL }}>
              <Icon name="badgeCheck" size={20} color={ROYAL} />
              <div style={{ display: 'flex', marginLeft: 8 }}>Vérifié par Lukka Place</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          {royalLogo ? (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
            <img src={royalLogo} width={LOGO_WIDTH} height={LOGO_HEIGHT} style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }} />
          ) : (
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: ROYAL }}>Lukka Place</div>
          )}
          <div style={{ display: 'flex', fontSize: 18, fontWeight: 600, lineHeight: 1, paddingBottom: 3, color: MUTED }}>lukkaplace.com</div>
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
    loadOgPhotos(listingImages(listing)),
    loadOgWordmark(),
    loadOgRoyalLogo(),
  ]);
  const allFonts = [...fonts, ...serif];
  const png = await new ImageResponse(
    <OgCard model={model} photos={photos} wordmark={wordmark} royalLogo={royalLogo} serif={serif.length > 0} />,
    { ...size, ...(allFonts.length ? { fonts: allFonts } : {}) },
  ).arrayBuffer();

  const headers = { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400' };
  const jpeg = await pngToJpeg(png);
  if (!jpeg) return new Response(png, { headers: { ...headers, 'Content-Type': 'image/png' } });
  return new Response(jpeg, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
}
