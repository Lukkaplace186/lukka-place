'use strict';

/**
 * smartimmo-app.com — a Kinshasa listing app whose web pages carry
 * schema.org data (RealEstateListing: bedrooms, commune, price, the words
 * "à louer" / "à vendre" and "/ mois"). Its sitemap lists every advert;
 * the advert id is a UUIDv7, whose first 48 bits are the creation time in
 * milliseconds — so "posted in 2026" is known before any page is read.
 *
 * Measured 2026-11-04: ~1,480 adverts, all created in 2026, Limete-heavy.
 * Each night: the sitemap (one request), then only adverts not stored yet,
 * residential kinds only (from the slug), at most `maxDetailFetches`, 3 s
 * apart. Adverts already stored and still in the sitemap are only marked
 * seen. The first run is long by design; the backlog drains over a few nights.
 */

const { createFetcher } = require('./http');
const { stripTags, fold, periodFromText, isFurnished, purposeFromText } = require('./text');

const SITEMAP = 'https://www.smartimmo-app.com/sitemap-properties.xml';
const RESIDENTIAL_SLUGS = ['appartement', 'maison', 'villa', 'studio', 'duplex', 'penthouse'];

/** UUIDv7 → creation instant (ISO), or null for any other uuid. */
function uuidV7Time(uuid) {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(uuid || '');
  if (!match) return null;
  const ms = Number.parseInt(`${match[1]}${match[2]}`, 16);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Sitemap → French advert pages [{ url, uuid, slugKind, createdAt }]. Pure. */
function parseSitemap(xml) {
  const out = [];
  const seen = new Set();
  for (const match of String(xml).matchAll(/<loc>(https:\/\/www\.smartimmo-app\.com\/fr\/annonce\/([^<]+))<\/loc>/g)) {
    const slug = match[2];
    const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(slug)?.[1];
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    out.push({ url: match[1], uuid, slugKind: slug.split('-')[0], createdAt: uuidV7Time(uuid) });
  }
  return out;
}

function listingNode(html) {
  for (const match of String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    const nodes = Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    const residence = nodes.find((n) => n && n.offers && (n.numberOfBedrooms !== undefined || n.address));
    if (residence) return residence;
  }
  return null;
}

/** An advert page → a raw observation, or null when it carries no listing data. Pure. */
function parseListingPage(html, { url, uuid, createdAt }) {
  const node = listingNode(html);
  if (!node) return null;
  const name = stripTags(node.name || '');
  const description = stripTags(node.description || '');
  const priceSentence = (/prix\s*:[^.]{0,60}/i.exec(description) || [''])[0];
  const purpose = purposeFromText(name) || purposeFromText(description.slice(0, 200));
  const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  return {
    source_ref: uuid,
    source_url: url,
    posted_at: createdAt,
    purpose,
    kind_text: `${node['@type'] || ''} ${name}`,
    beds: Number.isInteger(node.numberOfBedrooms) ? node.numberOfBedrooms : null,
    furnished: isFurnished(`${name} ${url}`),
    price: Number(offer?.price),
    currency: /cdf|fc/i.test(offer?.priceCurrency || '') ? 'CDF' : 'USD',
    price_period: purpose === 'rent' ? (periodFromText(priceSentence) || 'mois') : 'total',
    // addressRegion is the commune ("Limete"); a city other than Kinshasa
    // comes with it so a same-named commune elsewhere is not read as Kinshasa's.
    commune: node.address?.addressRegion
      ? (fold(node.address.addressLocality || 'kinshasa') === 'kinshasa' ? node.address.addressRegion : `${node.address.addressRegion}, ${node.address.addressLocality}`)
      : null,
    place_text: name,
    title: name,
  };
}

async function collect({ since, knownRefs = new Set(), maxDetailFetches = 600, log = () => {}, fetcher = createFetcher({ minIntervalMs: 3000 }) } = {}) {
  const entries = parseSitemap(await fetcher.text(SITEMAP))
    .filter((e) => e.createdAt && e.createdAt >= since && RESIDENTIAL_SLUGS.includes(e.slugKind));
  const stillListed = entries.filter((e) => knownRefs.has(e.uuid)).map((e) => e.uuid);
  const toRead = entries.filter((e) => !knownRefs.has(e.uuid)).slice(0, maxDetailFetches);
  const observations = [];
  for (const entry of toRead) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const observation = parseListingPage(await fetcher.text(entry.url), entry);
      if (observation) observations.push(observation);
    } catch (err) {
      log(`smartimmo: ${entry.url}: ${err.message}`);
      if (err.code === 'ROBOTS_DISALLOWED') break;
    }
  }
  const backlog = entries.length - stillListed.length - toRead.length;
  log(`smartimmo: ${entries.length} residential advert(s) since ${since.slice(0, 10)}, ${stillListed.length} already stored, ${toRead.length} read, ${backlog} left for later nights`);
  return { observations, stillListed, requests: fetcher.requests };
}

module.exports = { collect, parseSitemap, parseListingPage, uuidV7Time, RESIDENTIAL_SLUGS };
