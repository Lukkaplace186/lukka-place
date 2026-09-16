import { ImageResponse } from 'next/og';
import { getCurrentAgentId } from '@/lib/agentSession';
import {
  getFlyerListing,
  frenchTypeText,
  loadFlyerPhotos,
  loadFlyerFonts,
  loadAgentBrand,
  loadPlatformMark,
  PLATFORM_MARK_ASPECT,
} from '@/lib/listingFlyer';
import { shareBlocker, roomSpecs } from '@/lib/listingShareCopy';
import { formatPriceParts } from '@/lib/format';
import { CHECK_PATH, CHECK_STROKE_WIDTH, WHATSAPP_PATH } from '@/lib/marketing/icons';

/**
 * GET /compte/agent/biens/:id/visuel — the agent's 1080×1080 social graphic
 * for one of their own listings: up to three real photos, then three lines —
 * price, type • place, rooms — and the agent's own brand block beside the
 * Lukka Place mark.
 *
 * Square because WhatsApp Status, Instagram and Facebook groups all crop to
 * it well. Rendered on demand rather than stored: the price or photos change,
 * and a cached flyer showing last month's price is a flyer that lies.
 *
 * ROYAL BLUE, AND THE AGENT'S BRAND WHERE THE QR CODE WAS. Both on an explicit
 * product decision: the card carries Lukka Place's own brand colour so every
 * listing an agent shares reads as one platform, and the agent's logo, name
 * and gold verification badge turn that same graphic into their marketing.
 * The link lives in the caption the share dialog copies, which is what the QR
 * duplicated.
 *
 * `middleware.js` already gates /compte/agent/*; the session is re-read here
 * anyway because a route handler must not depend on a redirect it cannot see,
 * and ownership is enforced in the SQL (lib/listingFlyer.js).
 *
 * `?download=1` sends it as an attachment; otherwise inline, for the preview.
 *
 * JPEG, NOT PNG. satori only emits PNG, and for three photos that is ~970 KB —
 * 10-20 s on the 3G most agents share from. The same pixels re-encoded with
 * mozjpeg at quality 85 are ~100 KB and indistinguishable once WhatsApp has
 * re-compressed them for Status anyway. If sharp cannot load, the PNG is sent
 * as it was rendered rather than failing the flyer.
 */
export const dynamic = 'force-dynamic';

const ROYAL = '#1e3aa8';
const ROYAL_DEEP = '#16307e';
const INK = '#0b1120';
const GOLD = '#f59e0b';
// 6px of white between photos — the editorial seam, and the reason the photo
// band sits on a white ground rather than the blue one. It was 2px, which read
// as a hairline at WhatsApp Status size.
const GAP = 6;
const SIZE = 1080;
const PHOTO_HEIGHT = 640;
const MARK_WIDTH = 150;

/**
 * Two marks satori can draw: it renders `<img>` from a data URI reliably,
 * where a bare glyph would depend on the loaded face carrying it (Plus Jakarta
 * Sans has no ✓, and a missing glyph is a blank box, not a fallback).
 * The WhatsApp path is the same one components/WhatsAppCTA.js hand-rolls —
 * this lucide version ships no brand glyphs.
 */
const svgDataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const WHATSAPP_MARK = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff"><path d="${WHATSAPP_PATH}"/></svg>`,
);

// Ink on gold, not white on gold: white on #f59e0b is 2.1:1, which fails even
// the 3:1 bar for a graphic. Ink on gold is 8.6:1 and still reads as gold.
const CHECK_MARK = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="${CHECK_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"><path d="${CHECK_PATH}"/></svg>`,
);

export async function GET(request, { params }) {
  const agentId = await getCurrentAgentId();
  if (!agentId) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;
  const propertyId = Number.parseInt(id, 10);
  if (!Number.isFinite(propertyId)) return new Response('Not found', { status: 404 });

  const listing = await getFlyerListing(agentId, propertyId);
  if (!listing) return new Response('Not found', { status: 404 });

  const blocker = shareBlocker(listing);
  if (blocker) return Response.json({ error: blocker }, { status: 409 });

  const [photos, fonts, brand, mark] = await Promise.all([
    loadFlyerPhotos(listing),
    loadFlyerFonts(),
    loadAgentBrand(listing),
    loadPlatformMark(),
  ]);

  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  const purposeLabel = listing.purpose === 'sale' ? 'À VENDRE' : listing.purpose === 'rent' ? 'À LOUER' : null;
  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  // Two lines under the price, not one: "Appartement • 24 Novembre, Lingwala"
  // then "2 chambres • 2 salles de bain". With its own line the rooms keep
  // their full words — abbreviating was only ever a fix for one crowded line.
  const facts = [frenchTypeText(listing), place].filter(Boolean).join('  •  ');
  const rooms = roomSpecs(listing).join('  •  ');
  const hasBrand = Boolean(brand.logo || brand.initials);

  const download = new URL(request.url).searchParams.get('download') === '1';

  const rendered = new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: 'flex', flexDirection: 'column', background: ROYAL, fontFamily: 'Jakarta' }}>
        <div style={{ position: 'relative', display: 'flex', width: SIZE, height: PHOTO_HEIGHT, background: '#ffffff' }}>
          <PhotoGrid photos={photos} />
          {purposeLabel ? (
            <div
              style={{
                position: 'absolute', top: 36, left: 36, display: 'flex',
                background: '#ffffff', color: ROYAL, fontSize: 30, fontWeight: 800,
                letterSpacing: 2, padding: '12px 26px', borderRadius: 999,
              }}
            >
              {purposeLabel}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flex: 1, padding: '38px 48px', gap: 36 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', color: '#ffffff' }}>
                <span style={{ fontSize: 80, fontWeight: 800, lineHeight: 1 }}>{amount}</span>
                {period ? <span style={{ fontSize: 34, fontWeight: 500, marginLeft: 14, color: 'rgba(255,255,255,0.78)' }}>{period}</span> : null}
              </div>
              {facts ? (
                <div style={{ display: 'flex', marginTop: 18, fontSize: 31, fontWeight: 500, lineHeight: 1.25, color: '#ffffff' }}>
                  {facts}
                </div>
              ) : null}
              {rooms ? (
                <div style={{ display: 'flex', marginTop: 10, fontSize: 26, fontWeight: 500, lineHeight: 1.25, color: 'rgba(255,255,255,0.8)' }}>
                  {rooms}
                </div>
              ) : null}
            </div>
            {/* The roofline over the name is the real logo lockup; the white
                cut is the one that survives royal blue. */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              {mark ? (
                // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                <img src={mark} width={MARK_WIDTH} height={MARK_WIDTH / PLATFORM_MARK_ASPECT} style={{ width: MARK_WIDTH, height: MARK_WIDTH / PLATFORM_MARK_ASPECT, marginBottom: 6, marginLeft: 35 }} />
              ) : null}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <span style={{ fontSize: 38, fontWeight: 800, color: '#ffffff' }}>Lukka Place</span>
                <span style={{ fontSize: 25, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>lukkaplace.com</span>
              </div>
            </div>
          </div>

          {hasBrand ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 290 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 176, height: 176, background: '#ffffff', borderRadius: 26, padding: 16,
                }}
              >
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                  <img src={brand.logo} width={144} height={144} style={{ width: 144, height: 144, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 68, fontWeight: 800, color: ROYAL }}>{brand.initials}</span>
                )}
              </div>

              {brand.name ? (
                <span
                  style={{
                    marginTop: 14, fontSize: 25, fontWeight: 800, color: '#ffffff',
                    textAlign: 'center', lineHeight: 1.2, maxHeight: 60, overflow: 'hidden',
                  }}
                >
                  {brand.name}
                </span>
              ) : null}

              {/* Gold only for an agent whose documents were actually reviewed. */}
              {brand.badge ? (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
                    background: GOLD, color: INK, borderRadius: 999, padding: '7px 16px',
                    fontSize: 21, fontWeight: 800,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                  <img src={CHECK_MARK} width={20} height={20} style={{ width: 20, height: 20 }} />
                  {brand.badge}
                </div>
              ) : null}

              {brand.phone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                  <img src={WHATSAPP_MARK} width={26} height={26} style={{ width: 26, height: 26 }} />
                  <span style={{ fontSize: 24, fontWeight: 600, color: '#ffffff' }}>{brand.phone}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      fonts: fonts.length ? fonts : undefined,
    },
  );
  const png = Buffer.from(await rendered.arrayBuffer());
  const { body, type, ext } = await toJpeg(png);

  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="lukka-place-bien-${listing.id}.${ext}"`,
    },
  });
}

const FLYER_JPEG_QUALITY = 85;

async function toJpeg(png) {
  try {
    const { default: sharp } = await import('sharp');
    const body = await sharp(png).jpeg({ quality: FLYER_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    return { body, type: 'image/jpeg', ext: 'jpg' };
  } catch (err) {
    console.error(`[flyer] JPEG encode failed, sending PNG: ${err.message}`);
    return { body: png, type: 'image/png', ext: 'png' };
  }
}

/**
 * 3 photos: one large + two stacked. 2: side by side. 1: full bleed.
 * 0: a plain branded panel — never a borrowed photo.
 *
 * The gaps are the white ground showing through, not a drawn border.
 */
function PhotoGrid({ photos }) {
  const cover = (src, width, height) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} width={width} height={height} style={{ width, height, objectFit: 'cover' }} />
  );

  if (!photos.length) {
    return (
      <div style={{ display: 'flex', width: SIZE, height: PHOTO_HEIGHT, background: ROYAL_DEEP, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 96, fontWeight: 800, color: '#ffffff' }}>Lukka Place</span>
      </div>
    );
  }
  if (photos.length === 1) return cover(photos[0], SIZE, PHOTO_HEIGHT);
  if (photos.length === 2) {
    const half = (SIZE - GAP) / 2;
    return (
      <div style={{ display: 'flex', gap: GAP }}>
        {cover(photos[0], half, PHOTO_HEIGHT)}
        {cover(photos[1], half, PHOTO_HEIGHT)}
      </div>
    );
  }
  const big = 700;
  const side = SIZE - big - GAP;
  const small = (PHOTO_HEIGHT - GAP) / 2;
  return (
    <div style={{ display: 'flex', gap: GAP }}>
      {cover(photos[0], big, PHOTO_HEIGHT)}
      <div style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
        {cover(photos[1], side, small)}
        {cover(photos[2], side, small)}
      </div>
    </div>
  );
}
