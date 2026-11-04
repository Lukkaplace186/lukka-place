'use strict';

/**
 * alain-realty.net — an agency site (WordPress, RealHomes theme) with no
 * public REST route for its adverts. Read from its property sitemap: each
 * advert whose sitemap date is on or after `since` is read (its page states
 * status, price and period, bedrooms and the place).
 *
 * Measured 2026-11-04: 223 adverts, ~30 updated in 2026, mostly Gombe. The
 * sitemap date is the advert's last change, not its first post, so it is
 * kept as the observation's date only to decide what is 2026.
 */

const { createFetcher } = require('./http');
const { stripTags, parseAmount, periodFromText, isFurnished, purposeFromText } = require('./text');

const SITEMAP = 'https://alain-realty.net/property-sitemap.xml';

/** Sitemap → [{ url, lastmod }] for advert pages (/bien/<slug>/). Pure. */
function parseSitemap(xml) {
  const out = [];
  for (const match of String(xml).matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) {
    const url = match[1].trim();
    if (/\/bien\/[^/]+\/?$/.test(url)) out.push({ url, lastmod: match[2] || null });
  }
  return out;
}

const classText = (html, cls, tag = '[a-z0-9]+') => {
  const match = new RegExp(`<${tag}[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</`, 'i').exec(html);
  return match ? stripTags(match[1]) : null;
};

/** An advert page → a raw observation. Pure; exported for the tests. */
function parsePropertyPage(html, { url, lastmod }) {
  const status = classText(html, 'status', 'p') || '';
  const priceText = classText(html, 'price', 'p') || '';
  const address = classText(html, 'rh_page__property_address', 'p');
  const titleMatch = /<h1[^>]*class="[^"]*rh_page__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
    || /<title>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]).replace(/\s*[-|–]\s*Alain Realty.*$/i, '') : null;
  // An inline SVG icon sits between the label and the figure.
  const bedsMatch = /prop_bedrooms[\s\S]{0,6000}?<span class="figure">\s*(\d+)\s*<\/span>/i.exec(html);
  const postId = /\bpostid-(\d+)\b/.exec(html)?.[1];
  const purpose = purposeFromText(status) || purposeFromText(title || '');
  return {
    source_ref: postId || url,
    source_url: url,
    posted_at: lastmod,
    purpose,
    kind_text: title || '',
    beds: bedsMatch ? Number(bedsMatch[1]) : null,
    furnished: isFurnished(`${title || ''} ${url}`),
    price: parseAmount(priceText.replace(/\/.*$/, '')),
    currency: /fc|cdf/i.test(priceText) ? 'CDF' : 'USD',
    price_period: purpose === 'rent' ? (periodFromText(priceText) || 'mois') : 'total',
    place_text: address,
    commune: address,
    title,
  };
}

/**
 * Every 2026-dated advert is re-read each night (~30 pages, 3 s apart): the
 * site is small, and re-reading is what keeps a changed price current.
 */
async function collect({ since, maxDetailFetches = 600, log = () => {}, fetcher = createFetcher({ minIntervalMs: 3000 }) } = {}) {
  const entries = parseSitemap(await fetcher.text(SITEMAP)).filter((e) => !e.lastmod || e.lastmod >= since.slice(0, 10));
  const observations = [];
  let fetched = 0;
  for (const entry of entries) {
    if (fetched >= maxDetailFetches) break;
    fetched += 1;
    try {
      // eslint-disable-next-line no-await-in-loop
      const html = await fetcher.text(entry.url);
      observations.push(parsePropertyPage(html, entry));
    } catch (err) {
      log(`alain_realty: ${entry.url}: ${err.message}`);
    }
  }
  log(`alain_realty: ${entries.length} advert(s) dated since ${since.slice(0, 10)}, ${fetched} read`);
  return { observations, stillListed: [], requests: fetcher.requests };
}

module.exports = { collect, parseSitemap, parsePropertyPage };
