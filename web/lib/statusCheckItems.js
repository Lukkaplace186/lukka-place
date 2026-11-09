import 'server-only';
import { getStatusListings } from './statusCheck';
import { placeLabel } from './placeLabel';
import { formatPrice } from './format';

/**
 * getStatusListings with the labels the board prints, formatted on the
 * server so the client component needs no gazetteer or price rules.
 * A CDF listing shows the agent's own FC figure (exact, never "≈").
 */
export async function getStatusBoardItems(agentId, now = new Date()) {
  const rows = await getStatusListings(agentId, now);
  return rows.map((row) => {
    let priceLabel = formatPrice(row.price, row.purpose, row.pricePeriod);
    if (row.currency === 'CDF' && row.authoredPrice) {
      priceLabel = `${new Intl.NumberFormat('fr-FR').format(row.authoredPrice)} FC`;
    }
    return { ...row, place: placeLabel({ quartier: row.quartier, commune: row.commune }) || null, priceLabel };
  });
}
