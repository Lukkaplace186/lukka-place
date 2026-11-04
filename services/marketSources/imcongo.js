'use strict';

/**
 * imcongo.com — Kinshasa result lists, one page per property type and
 * purpose (the page holds up to 100 adverts: "0_100" in the URL). Only the
 * list is read, never the advert pages: it already states the price and its
 * period, the bedroom count, the commune and the reference, so six pages a
 * night cover the residential market at the Crawl-delay the site asks for.
 *
 * Its adverts carry no date. An advert is recorded the first night it is
 * seen and `last_seen_at` moves while it stays listed; readers count it
 * while it was seen recently (web lib/marketGuide.js).
 *
 * Terms: "toute reproduction et/ou rediffusion de contenu … doit faire
 * l'objet d'une autorisation". Nothing is reproduced: a price, a count and a
 * commune per advert go into a median, never onto a page.
 */

const { createFetcher } = require('./http');
const { stripTags, decodeEntities, parseAmount, periodFromText, isFurnished } = require('./text');

const ORIGIN = 'https://www.imcongo.com';
/** IMCongo's own type ids (its search form). */
const TYPES = [
  { id: 4, kind: 'appartement' },
  { id: 3, kind: 'maison' },
  { id: 15, kind: 'appartement' }, // "Flat"
];

function listUrl(typeId, purpose) {
  const verb = purpose === 'sale' ? 'a-vendre' : 'a-louer';
  return `${ORIGIN}/congo-${verb}-recherche-${typeId}___0_100_KINSHASA:Kinshasa:_________-immo-fr.html`;
}

/**
 * A result page → raw observations. Pure; exported for the tests.
 *
 * The page reads, per advert, "A louer | 2 000 $ / mois | 3 chambre(s) | … |
 * Appartement - Quartier Résidentiel | N° de référence: 22247 | 3 chambre(s) |
 * Kinshasa - Limete | Voir". It is split on the status word, which opens each
 * advert, and every field is read inside its own piece.
 */
function parseListPage(html, { kind, purpose }) {
  const links = new Map();
  for (const match of String(html).matchAll(/href="((?:https?:\/\/www\.imcongo\.com\/)?immo-congo-(\d+)_[^"]+)"/g)) {
    if (!links.has(match[2])) links.set(match[2], match[1].startsWith('http') ? match[1] : `${ORIGIN}/${match[1]}`);
  }
  const text = decodeEntities(String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '|'))
    .replace(/\s+/g, ' ')
    .replace(/(\|\s*)+/g, '|');
  const statusWord = purpose === 'sale' ? 'A vendre' : 'A louer';
  const pieces = text.split(new RegExp(`\\|\\s*${statusWord}\\s*\\|`, 'i')).slice(1);
  const observations = [];
  const seen = new Set();
  for (const piece of pieces) {
    const ref = /N° de référence\s*:\s*(\d+)/i.exec(piece)?.[1];
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const priceMatch = /^\s*([\d][\d\s.,]*)\s*(\$|USD|FC|CDF)\s*(\/\s*[a-zéû]+)?/i.exec(piece);
    const beds = /(\d+)\s*chambre\(s\)/i.exec(piece)?.[1];
    const fields = piece.split('|').map((f) => f.trim()).filter(Boolean);
    const refIndex = fields.findIndex((f) => /N° de référence/i.test(f));
    const title = refIndex > 0 ? fields[refIndex - 1] : null;
    const place = fields.find((f, i) => i > refIndex && /^[A-Za-zÀ-ÿ'’. -]+ - [A-Za-zÀ-ÿ0-9'’. -]+$/.test(f)) || null;
    observations.push({
      source_ref: ref,
      source_url: links.get(ref) || null,
      posted_at: null,
      purpose,
      property_kind: kind,
      beds: beds ? Number(beds) : null,
      furnished: isFurnished(title || ''),
      price: priceMatch ? parseAmount(priceMatch[1]) : null,
      currency: priceMatch && /fc|cdf/i.test(priceMatch[2]) ? 'CDF' : 'USD',
      price_period: purpose === 'rent' ? (periodFromText(priceMatch?.[3] || '') || 'mois') : 'total',
      place_text: place,
      commune: place ? place.split(' - ').slice(1).join(' - ') : null,
      title: title ? stripTags(title) : null,
    });
  }
  return observations;
}

async function collect({ log = () => {}, fetcher = createFetcher({ minIntervalMs: 10000 }) } = {}) {
  const observations = [];
  const failures = [];
  for (const purpose of ['rent', 'sale']) {
    for (const type of TYPES) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const html = await fetcher.text(listUrl(type.id, purpose));
        const found = parseListPage(html, { kind: type.kind, purpose });
        log(`imcongo: type ${type.id} ${purpose}: ${found.length}`);
        observations.push(...found);
      } catch (err) {
        // One slow page must not lose the other five; the adverts on it keep
        // their last_seen_at and are read again the next night.
        failures.push(`type ${type.id} ${purpose}: ${err.message}`);
        log(`imcongo: type ${type.id} ${purpose} failed: ${err.message}`);
      }
    }
  }
  if (failures.length === TYPES.length * 2) throw new Error(`every page failed (${failures[0]})`);
  return { observations, stillListed: [], requests: fetcher.requests };
}

module.exports = { collect, parseListPage, listUrl, TYPES };
