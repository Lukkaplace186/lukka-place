'use strict';

/**
 * Market observations from our own WhatsApp group captures
 * (services/groupRelay.js: listings with parsed_json.source = 'whatsapp-group').
 *
 * Every capture with a price is an asking price somebody posted in a broker
 * group, whether or not it was ever published: a capture with no photo stays
 * a draft (the photo rule), but its price is still a real price. A capture
 * that WAS published carries its `properties.id`; the readers skip it while
 * that listing is public, so it is never counted twice (web
 * lib/marketGuide.js).
 *
 * Captures from a group we were not authorised to read
 * (marketObservations.EXCLUDED_GROUP_JIDS) are never read here.
 */

const { db } = require('../db');
const { excludedGroupJids, COLLECT_SINCE } = require('../marketObservations');

const SELECT_SQL = `
  SELECT id, created_at, transaction_type, property_type, parcelle_subtype, commune, quartier, price,
         currency, price_period, bedrooms, furnished, remote_property_id,
         json_extract(parsed_json, '$.group_jid') AS group_jid
    FROM listings
   WHERE json_valid(parsed_json)
     AND json_extract(parsed_json, '$.source') = 'whatsapp-group'
     AND datetime(created_at) >= datetime(@since)
   ORDER BY id
`;

/** SQLite property_type (+ parcelle sub-type) → market kind. */
function kindOf(row) {
  const type = String(row.property_type || '').toLowerCase();
  if (type === 'parcelle') {
    const sub = String(row.parcelle_subtype || '').toLowerCase();
    if (sub.includes('villa')) return 'villa';
    if (sub.includes('terrain')) return 'terrain';
    // "Maison Type Locataire", or a parcelle let by its rooms: a home.
    return row.bedrooms ? 'maison' : 'terrain';
  }
  const map = {
    appartement: 'appartement', studio: 'studio', maison: 'maison', villa: 'villa', duplex: 'duplex',
    penthouse: 'penthouse', chambre: 'chambre', terrain: 'terrain', concession: 'terrain', ferme: 'terrain',
    bureau: 'bureau', boutique: 'commercial', entrepot: 'commercial', immeuble: 'immeuble',
  };
  return map[type] || null;
}

/** One SQLite row → a raw observation. Exported for the tests. */
function toObservation(row) {
  const purpose = row.transaction_type === 'location' ? 'rent' : row.transaction_type === 'vente' ? 'sale' : null;
  return {
    source_ref: `listing:${row.id}`,
    source_url: null,
    property_id: row.remote_property_id || null,
    posted_at: row.created_at,
    purpose,
    property_kind: kindOf(row),
    beds: row.bedrooms,
    furnished: row.furnished === 1 ? true : row.furnished === 0 ? false : null,
    price: row.price,
    currency: row.currency,
    price_period: row.price_period,
    commune_key: row.commune,
    quartier: row.quartier,
    title: null,
  };
}

async function collect({ since = COLLECT_SINCE, sqlite = db } = {}) {
  const excluded = excludedGroupJids();
  const sinceSql = since.replace('T', ' ').replace(/(\.\d+)?Z$/, '');
  const rows = sqlite.prepare(SELECT_SQL).all({ since: sinceSql });
  const observations = rows.filter((row) => !excluded.has(row.group_jid)).map(toObservation);
  return { observations, stillListed: [], requests: 0 };
}

module.exports = { collect, toObservation, kindOf, SELECT_SQL };
