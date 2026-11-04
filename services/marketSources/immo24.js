'use strict';

/**
 * immo24.cd — an agency site on WordPress (Houzez theme) that publishes its
 * adverts through the public REST feed /wp-json/wp/v2/properties. Read
 * newest first, 100 per page, until an advert older than `since`.
 *
 * Measured 2026-11-04: 595 adverts in all, 25 posted in 2026 — mostly
 * furnished flats in Gombe and GB. Furnished adverts are kept with
 * `furnished = true`, which the guide leaves out; the rest count.
 */

const { createFetcher } = require('./http');
const { stripTags, fold, periodFromText, isFurnished, purposeFromText } = require('./text');

const BASE = 'https://immo24.cd/wp-json/wp/v2';
const FIELDS = 'id,date_gmt,link,title,content,property_type,property_status,property_city,property_area,property_meta';

/** Taxonomy id → name, for the four taxonomies an advert carries. */
async function loadTaxonomies(fetcher) {
  const names = {};
  for (const tax of ['property_type', 'property_status', 'property_city', 'property_area']) {
    // eslint-disable-next-line no-await-in-loop
    const { body } = await fetcher.json(`${BASE}/${tax}?per_page=100&_fields=id,name`);
    names[tax] = Object.fromEntries((Array.isArray(body) ? body : []).map((t) => [t.id, stripTags(t.name)]));
  }
  return names;
}

const first = (value) => (Array.isArray(value) ? value[0] : value);

/**
 * One REST item → a raw observation. Exported for the tests.
 * @param {object} item
 * @param {Record<string, Record<number, string>>} tax
 */
function toObservation(item, tax) {
  const meta = item.property_meta || {};
  const title = stripTags(item.title?.rendered);
  const content = stripTags(item.content?.rendered);
  const statusName = (item.property_status || []).map((id) => tax.property_status?.[id]).filter(Boolean).join(' ');
  const typeName = (item.property_type || []).map((id) => tax.property_type?.[id]).filter(Boolean).join(' ');
  const cityName = (item.property_city || []).map((id) => tax.property_city?.[id]).filter(Boolean)[0] || '';
  const areaName = (item.property_area || []).map((id) => tax.property_area?.[id]).filter(Boolean)[0] || '';
  // Only the words around the price decide the period: "visites tous les
  // jours" elsewhere in the text must not turn a monthly rent into a day rate.
  const priceSentence = (/(prix|loyer|price|rent)\s*:?[^.!\n]{0,80}/i.exec(content) || [''])[0];
  const priceText = `${first(meta.fave_property_price_postfix) || ''} ${title} ${priceSentence}`;
  const purpose = purposeFromText(statusName) || purposeFromText(title);
  return {
    source_ref: String(item.id),
    source_url: item.link,
    posted_at: item.date_gmt ? `${item.date_gmt}Z` : null,
    purpose,
    kind_text: `${typeName} ${title}`,
    property_kind: undefined,
    beds: Number.parseInt(first(meta.fave_property_bedrooms), 10),
    furnished: isFurnished(`${title} ${content.slice(0, 400)}`),
    price: Number(first(meta.fave_property_price)),
    currency: /fc|cdf|franc/.test(fold(first(meta.fave_currency) || '')) ? 'CDF' : 'USD',
    price_period: purpose === 'rent' ? (periodFromText(priceText) || 'mois') : 'total',
    // A site outside Kinshasa (Goma, Mbanza-Ngungu) names its city here; the
    // area is the commune or quartier ("Gombe", "GB", "Kinshasa Centre Ville").
    place_text: areaName,
    commune: /kinshasa/i.test(cityName) || !cityName ? areaName : `${areaName}, ${cityName}`,
    title,
  };
}

/** The first page item's kind name, for the tests' sake kept out of collect(). */
async function collect({ since, log = () => {}, fetcher = createFetcher({ minIntervalMs: 3000 }) } = {}) {
  const tax = await loadTaxonomies(fetcher);
  const observations = [];
  const sinceMs = Date.parse(since);
  for (let page = 1; page <= 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { body, headers } = await fetcher.json(`${BASE}/properties?per_page=100&page=${page}&orderby=date&order=desc&_fields=${FIELDS}`);
    if (!Array.isArray(body) || body.length === 0) break;
    let older = false;
    for (const item of body) {
      if (Date.parse(`${item.date_gmt}Z`) < sinceMs) { older = true; continue; }
      observations.push(toObservation(item, tax));
    }
    const totalPages = Number(headers.get('x-wp-totalpages')) || page;
    if (older || page >= totalPages) break;
  }
  log(`immo24: ${observations.length} advert(s) since ${since.slice(0, 10)}`);
  return { observations, stillListed: [], requests: fetcher.requests };
}

module.exports = { collect, toObservation };
