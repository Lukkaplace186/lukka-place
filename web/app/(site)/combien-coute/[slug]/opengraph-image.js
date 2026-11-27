import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { getPriceGuide } from '@/lib/browseFeatures';
import { loadOgFonts } from '@/lib/listingOgImage';
import { communeLabel } from '@/lib/cities';
import { formatGuideDay } from '@/lib/priceGuideSeo';

/**
 * A price guide page's link preview (2026-11-21, marketing plan: the pages
 * had no og:image, so a shared guide showed the site's generic card). The
 * Indice Lukka card's style (../../indice-lukka/opengraph-image.js): the
 * question, the median, how many listings it rests on and the data's date —
 * exactly what the page says, nothing more. French always, like every share
 * card: a crawler sends no locale cookie. An unknown slug is a 404, never a
 * card for a guide that does not exist.
 */
export const alt = 'Guide des loyers Lukka Place : loyer médian demandé';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const ROYAL = '#1E3AA8';
const INK = '#0B1120';
const MUTED = '#5C6679';

const money = (value) => `${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;

export default async function Image({ params }) {
  const { slug } = await params;
  const [guide, fonts] = await Promise.all([getPriceGuide(slug), loadOgFonts()]);
  if (!guide) notFound();
  const commune = communeLabel(guide.commune);
  const question = guide.beds === 1
    ? `Combien coûte un 1 chambre à ${commune} ?`
    : `Combien coûte un ${guide.beds} chambres à ${commune} ?`;
  const updated = formatGuideDay(guide.updatedOn, 'fr');
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#FFFFFF', fontFamily: 'Jakarta', padding: 64 }}>
        <div style={{ display: 'flex', color: ROYAL, fontSize: 30, fontWeight: 800 }}>Guide des loyers · Lukka Place</div>
        <div style={{ display: 'flex', color: INK, fontSize: 52, fontWeight: 800, marginTop: 18, lineHeight: 1.15 }}>{question}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 36 }}>
          <span style={{ color: ROYAL, fontSize: 96, fontWeight: 800 }}>{money(guide.median)}</span>
          <span style={{ color: MUTED, fontSize: 36, fontWeight: 700, marginLeft: 16 }}>/ mois</span>
        </div>
        <div style={{ display: 'flex', color: INK, fontSize: 30, marginTop: 12 }}>
          {`Loyer médian demandé, sur ${guide.listings} annonces · la moitié entre ${money(guide.p25)} et ${money(guide.p75)}`}
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', color: MUTED, fontSize: 24 }}>
          {`lukkaplace.com/combien-coute${updated ? ` — mis à jour le ${updated}` : ''}`}
        </div>
      </div>
    ),
    { ...size, ...(fonts.length ? { fonts } : {}) },
  );
}
