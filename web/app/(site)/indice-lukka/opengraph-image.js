import { ImageResponse } from 'next/og';
import { getLukkaIndex } from '@/lib/browseFeatures';
import { loadOgFonts } from '@/lib/listingOgImage';
import { communeLabel } from '@/lib/cities';

/**
 * The Lukka Index as one shareable picture (1200×630, the size every chat
 * app previews): today's median asking rent for the top communes (Lukka
 * Place listings and asking prices seen elsewhere, lib/lukkaIndex.js).
 * Also what /indice-lukka's "Télécharger l'image" saves. French always, like
 * every share card.
 */
export const alt = 'Indice Lukka : loyer médian demandé par commune';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const ROYAL = '#1E3AA8';
const INK = '#0B1120';

const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (value) => `${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} $`;

export default async function Image() {
  const [index, fonts] = await Promise.all([getLukkaIndex(), loadOgFonts()]);
  const rows = (index?.communes || []).slice(0, 8);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#FFFFFF', fontFamily: 'Jakarta', padding: 56 }}>
        <div style={{ display: 'flex', color: ROYAL, fontSize: 30, fontWeight: 800 }}>Indice Lukka</div>
        <div style={{ display: 'flex', color: INK, fontSize: 44, fontWeight: 800, marginTop: 8 }}>
          {index ? `Loyer médian demandé — ${dayLabel(index.asOf)}` : 'Loyer médian demandé'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 28 }}>
          {rows.map((row) => (
            <div key={row.commune} style={{ display: 'flex', justifyContent: 'space-between', width: 520, marginRight: 32, padding: '12px 0', borderBottom: '2px solid #E5E7EB', fontSize: 28 }}>
              <span style={{ color: INK, fontWeight: 700 }}>{communeLabel(row.commune)}</span>
              <span style={{ color: ROYAL, fontWeight: 800 }}>
                {money(row.median)}
                {row.changePct != null ? ` (${row.changePct > 0 ? '+' : ''}${String(row.changePct).replace('.', ',')} %)` : ''}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', color: '#5C6679', fontSize: 22 }}>
          {index
            ? `lukkaplace.com/indice-lukka — ${String(index.listings).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} annonces (Lukka Place et marché), au moins 5 par commune`
            : 'lukkaplace.com/indice-lukka'}
        </div>
      </div>
    ),
    { ...size, ...(fonts.length ? { fonts } : {}) },
  );
}
