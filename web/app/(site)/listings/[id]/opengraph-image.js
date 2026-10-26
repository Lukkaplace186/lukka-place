import { ImageResponse } from 'next/og';
import { getListingById } from '@/lib/listings';
import { listingImages } from '@/lib/listingView';
import { createTranslator } from '@/lib/i18n/translate';
import fr from '@/lib/i18n/fr.json';
import { ogCardModel } from '@/lib/listingOgCard';
import { loadOgFonts, loadOgPhoto, loadOgWordmark, pngToJpeg } from '@/lib/listingOgImage';
import { LINE_ICONS } from '@/lib/marketing/icons';

/**
 * The listing's link preview — what WhatsApp, Facebook and X show when its
 * URL is pasted (2026-10-26; it used to be the bare cover photo). Next adds
 * og:image / og:image:width / height / type to the listing page's <head> from
 * this file, ahead of anything generateMetadata says; twitter-image.js beside
 * it serves the same card as twitter:image.
 *
 * What the card says is lib/listingOgCard.js (pure, tested); the photo, logo,
 * fonts and the PNG → JPEG step are lib/listingOgImage.js. Same public gate as
 * the page (getListingById): a pending, rejected or archived listing answers
 * 404, never a preview of it.
 *
 * Always French: a crawler sends no locale cookie, and the people the link is
 * sent to read the market's language. Cached 10 minutes, so a price change
 * reaches a NEW share quickly; WhatsApp keeps its own copy of a preview it has
 * already fetched, which nothing here can refresh.
 */

export const alt = 'Annonce Lukka Place : photo, prix et caractéristiques du bien';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/jpeg';
export const revalidate = 600;

const frT = createTranslator({ locale: 'fr', messages: fr });

const INK = '#0B1120';
const ROYAL = '#1E3AA8';
const ROYAL_DEEP = '#16307E';
const ROYAL_TINT = '#EEF2FF';
const MUTED = '#5C6679';

function Icon({ name, size: px, color, strokeWidth = 1.75 }) {
  return (
    <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {LINE_ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function Dot() {
  return <div style={{ display: 'flex', margin: '0 16px', color: 'rgba(255,255,255,0.45)' }}>·</div>;
}

function OgCard({ model, photo, wordmark }) {
  const facts = [];
  if (model.typeText) facts.push(<div key="type" style={{ display: 'flex' }}>{model.typeText}</div>);
  for (const spec of model.specs) {
    if (facts.length) facts.push(<Dot key={`dot-${spec.icon}`} />);
    facts.push(
      <div key={spec.icon} style={{ display: 'flex', alignItems: 'center' }}>
        <Icon name={spec.icon} size={28} color="#FFFFFF" />
        <div style={{ display: 'flex', marginLeft: 8 }}>{spec.text}</div>
      </div>,
    );
  }

  return (
    <div
      style={{
        width: 1200, height: 630, display: 'flex', position: 'relative', overflow: 'hidden',
        background: photo ? INK : ROYAL_DEEP, color: '#FFFFFF', fontFamily: 'Jakarta',
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
        <img src={photo} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 630 }} />
      ) : null}
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: 1200, height: 630, display: 'flex',
          backgroundImage: 'linear-gradient(180deg, rgba(11,17,32,0.62) 0%, rgba(11,17,32,0) 30%, rgba(11,17,32,0) 46%, rgba(11,17,32,0.78) 100%)',
        }}
      />

      {wordmark ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not the DOM
        <img src={wordmark} width={210} height={67} style={{ position: 'absolute', left: 48, top: 40, width: 210, height: 67 }} />
      ) : (
        <div style={{ position: 'absolute', left: 48, top: 48, display: 'flex', fontSize: 40, fontWeight: 800 }}>Lukka Place</div>
      )}

      {model.purposeBadge ? (
        <div
          style={{
            position: 'absolute', right: 48, top: 50, display: 'flex', padding: '10px 18px', borderRadius: 999,
            background: '#FFFFFF', color: ROYAL_DEEP, fontSize: 16, fontWeight: 800, letterSpacing: 2, lineHeight: 1,
          }}
        >
          {model.purposeBadge}
        </div>
      ) : null}

      <div style={{ position: 'absolute', left: 0, top: 196, width: 1200, display: 'flex', justifyContent: 'center' }}>
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '26px 40px', borderRadius: 32,
            background: 'rgba(11,17,32,0.74)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline' }}>
            <div style={{ display: 'flex', fontSize: 66, fontWeight: 800, letterSpacing: -1.3, lineHeight: 1 }}>{model.amount}</div>
            {model.period ? (
              <div style={{ display: 'flex', marginLeft: 12, fontSize: 30, fontWeight: 600, lineHeight: 1, color: 'rgba(255,255,255,0.78)' }}>
                {model.period}
              </div>
            ) : null}
          </div>
          {facts.length ? (
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 14, fontSize: 25, fontWeight: 600, lineHeight: 1 }}>{facts}</div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          position: 'absolute', left: 32, top: 448, width: 1136, height: 150, padding: '0 36px', borderRadius: 20,
          background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: model.verified ? 760 : 1000 }}>
          {model.eyebrow ? (
            <div style={{ display: 'flex', fontSize: 15, fontWeight: 800, letterSpacing: 1.8, color: ROYAL, lineHeight: 1 }}>{model.eyebrow}</div>
          ) : null}
          <div style={{ display: 'flex', marginTop: model.eyebrow ? 10 : 0, fontSize: 34, fontWeight: 700, lineHeight: 1.18, color: INK }}>
            {model.heading}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: 32 }}>
          {model.verified ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', padding: '10px 16px', borderRadius: 999, marginBottom: 12,
                background: ROYAL_TINT, color: ROYAL_DEEP, fontSize: 17, fontWeight: 700, lineHeight: 1,
              }}
            >
              <Icon name="badgeCheck" size={22} color={ROYAL} strokeWidth={2} />
              <div style={{ display: 'flex', marginLeft: 8 }}>Vérifié par Lukka Place</div>
            </div>
          ) : null}
          <div style={{ display: 'flex', fontSize: 18, fontWeight: 600, color: MUTED, lineHeight: 1 }}>lukkaplace.com</div>
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
  const [fonts, photo, wordmark] = await Promise.all([loadOgFonts(), loadOgPhoto(listingImages(listing)[0]), loadOgWordmark()]);
  const png = await new ImageResponse(<OgCard model={model} photo={photo} wordmark={wordmark} />, {
    ...size,
    ...(fonts.length ? { fonts } : {}),
  }).arrayBuffer();

  const headers = { 'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400' };
  const jpeg = await pngToJpeg(png);
  if (!jpeg) return new Response(png, { headers: { ...headers, 'Content-Type': 'image/png' } });
  return new Response(jpeg, { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
}
