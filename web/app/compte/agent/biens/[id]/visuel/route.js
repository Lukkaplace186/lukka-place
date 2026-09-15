import { ImageResponse } from 'next/og';
import { getCurrentAgentId } from '@/lib/agentSession';
import {
  getFlyerListing,
  frenchTypeText,
  loadFlyerPhotos,
  loadFlyerFonts,
  qrDataUri,
} from '@/lib/listingFlyer';
import { shareBlocker, roomSpecs, listingPublicUrl } from '@/lib/listingShareCopy';
import { formatPriceParts } from '@/lib/format';

/**
 * GET /compte/agent/biens/:id/visuel — the agent's 1080×1080 social graphic
 * for one of their own listings: up to three real photos, price, rooms,
 * place, the Lukka Place wordmark and a QR code to the public listing page.
 *
 * Square because WhatsApp Status, Instagram and Facebook groups all crop to
 * it well. Rendered on demand rather than stored: the price or photos change,
 * and a cached flyer showing last month's price is a flyer that lies.
 *
 * `middleware.js` already gates /compte/agent/*; the session is re-read here
 * anyway because a route handler must not depend on a redirect it cannot see,
 * and ownership is enforced in the SQL (lib/listingFlyer.js).
 *
 * `?download=1` sends it as an attachment; otherwise inline, for the preview.
 */
export const dynamic = 'force-dynamic';

const INK = '#0b1120';
const BLUE = '#1e3aa8';
const GAP = 8;
const SIZE = 1080;
const PHOTO_HEIGHT = 640;

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

  const url = listingPublicUrl(listing.id);
  const [photos, fonts, qr] = await Promise.all([loadFlyerPhotos(listing), loadFlyerFonts(), qrDataUri(url)]);

  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  const purposeLabel = listing.purpose === 'sale' ? 'À VENDRE' : listing.purpose === 'rent' ? 'À LOUER' : null;
  const typeText = frenchTypeText(listing);
  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  const headline = [typeText, place].filter(Boolean).join(' · ');
  const specs = roomSpecs(listing);

  const download = new URL(request.url).searchParams.get('download') === '1';

  return new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: 'flex', flexDirection: 'column', background: INK, fontFamily: 'Jakarta' }}>
        <div style={{ position: 'relative', display: 'flex', width: SIZE, height: PHOTO_HEIGHT }}>
          <PhotoGrid photos={photos} />
          {purposeLabel ? (
            <div
              style={{
                position: 'absolute', top: 36, left: 36, display: 'flex',
                background: '#ffffff', color: BLUE, fontSize: 30, fontWeight: 800,
                letterSpacing: 2, padding: '12px 26px', borderRadius: 999,
              }}
            >
              {purposeLabel}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flex: 1, padding: '40px 48px 40px 48px', gap: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between', minWidth: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', color: '#ffffff' }}>
                <span style={{ fontSize: 80, fontWeight: 800, lineHeight: 1 }}>{amount}</span>
                {period ? <span style={{ fontSize: 36, fontWeight: 500, marginLeft: 14, color: 'rgba(255,255,255,0.75)' }}>{period}</span> : null}
              </div>
              {headline ? (
                <div style={{ display: 'flex', marginTop: 18, fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.88)' }}>
                  {headline}
                </div>
              ) : null}
              {specs.length ? (
                <div style={{ display: 'flex', marginTop: 12, fontSize: 30, fontWeight: 500, color: 'rgba(255,255,255,0.7)' }}>
                  {specs.join('  ·  ')}
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <span style={{ fontSize: 40, fontWeight: 800, color: '#ffffff' }}>Lukka Place</span>
              <span style={{ fontSize: 26, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>lukkaplace.com</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 250 }}>
            <div style={{ display: 'flex', background: '#ffffff', padding: 16, borderRadius: 20 }}>
              {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
              <img src={qr} width={218} height={218} />
            </div>
            <span style={{ marginTop: 14, fontSize: 22, fontWeight: 500, color: 'rgba(255,255,255,0.75)', textAlign: 'center' }}>
              Scannez pour voir le bien
            </span>
          </div>
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      fonts: fonts.length ? fonts : undefined,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="lukka-place-bien-${listing.id}.png"`,
      },
    },
  );
}

/**
 * 3 photos: one large + two stacked. 2: side by side. 1: full bleed.
 * 0: a plain branded panel — never a borrowed photo.
 */
function PhotoGrid({ photos }) {
  const cover = (src, width, height) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} width={width} height={height} style={{ width, height, objectFit: 'cover' }} />
  );

  if (!photos.length) {
    return (
      <div style={{ display: 'flex', width: SIZE, height: PHOTO_HEIGHT, background: BLUE, alignItems: 'center', justifyContent: 'center' }}>
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
