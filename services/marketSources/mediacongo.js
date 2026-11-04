'use strict';

/**
 * mediacongo.net — the "Immobilier (Vente, Location)" classifieds (category
 * 114). Measured 2026-11-04: ~7,800 adverts in the category since the site
 * began, ~2,180 posted in 2026 (pages 1–110 of 380, newest first, 20 a
 * page), about 5 new a day; roughly one in eight is a rental — it is mostly
 * a sales board.
 *
 * Each night:
 *  1. The category's list pages, newest first, until a page holds only
 *     adverts posted before `since` (or MAX_LIST_PAGES). A list item already
 *     gives the reference, title, "KINSHASA - Ngaliema", the post date and
 *     the price.
 *  2. Adverts already stored are only marked seen (`stillListed`).
 *  3. A new advert whose title says it is for SALE is stored from the list
 *     alone (no bedroom count is needed for a sale). A rental, or a title
 *     that says neither, opens its page for the bedroom count and the offer
 *     type, at most `maxDetailFetches` a night — the first nights drain the
 *     backlog.
 *
 * The advert page has two "annonce_data" blocks; the first ("Type d'offre :
 * Vente / Villa / 4 chambres") sits inside an HTML comment, the site's own
 * leftover, and never describes the advert. Comments are removed before the
 * fields are read — reading the first match took a 3-bedroom flat to let for
 * a 4-bedroom villa for sale.
 *
 * robots.txt (read 2026-11-04): no Disallow, Crawl-delay 10 — obeyed by
 * marketSources/http.js. Terms: "Toute reproduction et/ou rediffusion de
 * contenu … doit faire l'objet d'une autorisation" — same position as
 * IMCongo: a price, a bedroom count and a commune per advert go into a
 * median, nothing is reproduced or shown. Ads outside Kinshasa are stored
 * with no commune (a Boma "Kalamu" must not read as Kinshasa's).
 */

const { createFetcher } = require('./http');
const { stripTags, decodeEntities, fold, parseAmount, periodFromText, isFurnished, purposeFromText } = require('./text');

const ORIGIN = 'https://www.mediacongo.net';
const MAX_LIST_PAGES = 200;

function listUrl(page) {
  return page <= 1
    ? `${ORIGIN}/categories-cat-114_immobilier_vente_location.html`
    : `${ORIGIN}/categories-cat-114_immobilier_vente_location-page-${page}.html`;
}

/** "02.11.2026" → "2026-11-02T12:00:00.000Z" (midday, so no timezone moves the day). */
function postedAt(text) {
  const match = /(\d{2})\.(\d{2})\.(\d{4})/.exec(text || '');
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}T12:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "KINSHASA - Ngaliema" → { city: 'kinshasa', commune: 'Ngaliema' }. */
function splitWhere(text) {
  const clean = stripTags(text);
  const [city, ...rest] = clean.split(/\s+-\s+/);
  return { city: fold(city || '').trim(), commune: rest.join(' - ').trim() || null };
}

/** "1 300 $", "250 000 FC" → { price, currency }. */
function readPrice(text) {
  const clean = decodeEntities(String(text || '')).replace(/\s+/g, ' ');
  const amount = parseAmount((/[\d][\d\s.,]*/.exec(clean) || [''])[0]);
  return { price: amount, currency: /fc|cdf/i.test(clean) ? 'CDF' : 'USD' };
}

/** A category list page → items. Pure; exported for the tests. */
function parseListPage(html) {
  const items = [];
  const seen = new Set();
  const blocks = String(html).split(/<a class="annonce_item[^"]*"/).slice(1);
  for (const block of blocks) {
    const href = /^\s*href="([^"]*annonce-mediacongo-(\d+)_[^"]*)"/.exec(block);
    if (!href || seen.has(href[2])) continue;
    seen.add(href[2]);
    const title = stripTags((/<h2>([\s\S]*?)<\/h2>/.exec(block) || [])[1] || '');
    const where = splitWhere((/<span class="where">([\s\S]*?)<\/span>/.exec(block) || [])[1] || '');
    const date = postedAt(stripTags((/<span class="publie">([\s\S]*?)<\/span>/.exec(block) || [])[1] || ''));
    const { price, currency } = readPrice((/<div class="annonce_price">([\s\S]*?)<\/div>/.exec(block) || [])[1] || '');
    items.push({
      ref: href[2],
      url: href[1].startsWith('http') ? href[1] : `${ORIGIN}/${href[1].replace(/^\//, '')}`,
      title,
      city: where.city,
      commune: where.commune,
      postedAt: date,
      price,
      currency,
    });
  }
  return items;
}

/** "Offre :" → "Location", from the advert page's live data block (comments removed). */
function dataFields(html) {
  const live = String(html).replace(/<!--[\s\S]*?-->/g, ' ');
  const fields = {};
  for (const match of live.matchAll(/<div class="annonce_data_type">([\s\S]*?)<\/div>\s*<div class="annonce_data_value">([\s\S]*?)<\/div>/g)) {
    const label = fold(stripTags(match[1])).replace(/[^a-z]/g, '');
    if (!(label in fields)) fields[label] = stripTags(match[2]);
  }
  return fields;
}

function jsonLdOffer(html) {
  for (const match of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const nodes = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    const node = nodes.find((n) => n && n.offers);
    if (node) return { offer: Array.isArray(node.offers) ? node.offers[0] : node.offers, description: stripTags(node.description || '') };
  }
  return { offer: null, description: '' };
}

/** List item (+ its advert page when read) → a raw observation. Pure. */
function toObservation(item, html = null) {
  const kinshasa = item.city === 'kinshasa';
  const base = {
    source_ref: item.ref,
    source_url: item.url,
    posted_at: item.postedAt,
    kind_text: item.title,
    beds: null,
    furnished: isFurnished(item.title),
    price: item.price,
    currency: item.currency,
    commune: kinshasa ? item.commune : null,
    // No commune on the list ("KINSHASA" alone): the title, which
    // normaliseObservation resolves only when it names ONE commune.
    place_text: kinshasa ? (item.commune || item.title) : null,
    title: item.title,
  };
  if (!html) {
    const purpose = purposeFromText(item.title);
    return { ...base, purpose, price_period: purpose === 'sale' ? 'total' : (periodFromText(item.title) || 'mois') };
  }
  const fields = dataFields(html);
  const { offer, description } = jsonLdOffer(html);
  const offerText = fold(fields.offre || '');
  const purpose = /location|louer/.test(offerText) ? 'rent' : /vente|vendre/.test(offerText) ? 'sale' : purposeFromText(item.title);
  const bedsText = fields.chambres || fields.nombredechambres || '';
  const beds = /^\d{1,2}$/.test(bedsText.trim()) ? Number(bedsText.trim()) : null;
  const ldPrice = Number(offer?.price);
  return {
    ...base,
    purpose,
    // The advert's own "Type :" field decides; the title only when it is
    // empty. Mixed together, "Appartements … dans une parcelle" read as land
    // (non-residential wins in kindFromText) and left the rent medians.
    kind_text: fields.type ? fields.type : item.title,
    beds,
    furnished: isFurnished(`${item.title} ${fields.type || ''}`),
    price: Number.isFinite(ldPrice) && ldPrice > 0 ? ldPrice : item.price,
    currency: offer?.priceCurrency ? (/cdf|fc/i.test(offer.priceCurrency) ? 'CDF' : 'USD') : item.currency,
    price_period: purpose === 'sale' ? 'total' : (periodFromText(`${item.title} ${description.slice(0, 400)}`) || 'mois'),
  };
}

async function collect({ since, knownRefs = new Set(), maxDetailFetches = 600, log = () => {}, fetcher = createFetcher({ minIntervalMs: 10000 }) } = {}) {
  const sinceIso = new Date(since).toISOString();
  const recent = [];
  let pages = 0;
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    let items;
    try {
      // eslint-disable-next-line no-await-in-loop
      items = parseListPage(await fetcher.text(listUrl(page)));
    } catch (err) {
      if (page === 1) throw err;
      // A page that fails ends the walk; adverts further back keep their
      // last_seen_at and are read again the next night.
      log(`mediacongo: list page ${page} failed: ${err.message}`);
      break;
    }
    pages = page;
    if (!items.length) break;
    recent.push(...items.filter((i) => i.postedAt && i.postedAt >= sinceIso));
    // Stop once a whole page is older than `since` (one page past the edge):
    // a single old advert pinned near the top must not end the walk.
    const dated = items.filter((i) => i.postedAt);
    if (dated.length && dated.every((i) => i.postedAt < sinceIso)) break;
  }

  const stillListed = recent.filter((i) => knownRefs.has(i.ref)).map((i) => i.ref);
  const fresh = recent.filter((i) => !knownRefs.has(i.ref));
  const observations = [];
  const toRead = [];
  for (const item of fresh) {
    if (purposeFromText(item.title) === 'sale') observations.push(toObservation(item));
    else toRead.push(item);
  }
  const reading = toRead.slice(0, maxDetailFetches);
  for (const item of reading) {
    try {
      // eslint-disable-next-line no-await-in-loop
      observations.push(toObservation(item, await fetcher.text(item.url)));
    } catch (err) {
      log(`mediacongo: ${item.url}: ${err.message}`);
      if (err.code === 'ROBOTS_DISALLOWED') break;
    }
  }
  log(`mediacongo: ${pages} list page(s), ${recent.length} advert(s) since ${sinceIso.slice(0, 10)}, ${stillListed.length} already stored, ${fresh.length - toRead.length} sale(s) from the list, ${reading.length} advert page(s) read, ${toRead.length - reading.length} left for later nights`);
  return { observations, stillListed, requests: fetcher.requests };
}

module.exports = { collect, parseListPage, toObservation, dataFields, postedAt, listUrl, MAX_LIST_PAGES };
