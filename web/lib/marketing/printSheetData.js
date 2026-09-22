import 'server-only';
import QRCode from 'qrcode';
import { getPool } from '../db';

/**
 * The print pages' own reads (lib/marketing/printSheetLoader.js puts them
 * together with getFlyerListing). The extras query repeats the ownership
 * check so it can never be called on its own for somebody else's listing.
 */

const CONTENT_LANGUAGE_ID = 20;

/** features (text[]), coordinates, address and the feature-amenity tags (ids outside the commune range 21–44). */
export async function getPrintExtras(agentId, propertyId) {
  const { rows } = await getPool().query(
    `SELECT p.features, p.latitude, p.longitude, pc.address,
            (
              SELECT COALESCE(array_agg(ac.name ORDER BY a.serial_number, ac.name), ARRAY[]::text[])
                FROM property_amenities pa
                JOIN amenities a ON a.id = pa.amenity_id
                JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = $1
               WHERE pa.property_id = p.id AND pa.amenity_id NOT BETWEEN 21 AND 44
            ) AS amenities
       FROM properties p
       LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
      WHERE p.id = $2 AND p.agent_id = $3`,
    [CONTENT_LANGUAGE_ID, Number(propertyId), Number(agentId)],
  );
  return rows[0] || {};
}

/** The QR code as inline SVG markup, generated here so no image request or client library is needed. */
export function qrSvg(url) {
  return QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b1120', light: '#ffffff' } });
}
