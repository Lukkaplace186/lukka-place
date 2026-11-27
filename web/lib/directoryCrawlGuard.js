/**
 * Scrapers on the agent directory's filter combinations (2026-11-24).
 *
 * Every commune chip on /agents is a link that adds one more commune (up to
 * five), so the filtered URLs (`/agents?communes=A,B,C&offre=vente…`) never
 * run out. Measured on production that day: /agents was rendered about twice
 * a second (two directory queries each) while people opened it 24 times in
 * 24 hours — most of Supabase's egress (~3 GB a day of query results).
 *
 * SEARCH ENGINES AND AI ASSISTANTS ARE NEVER TURNED AWAY (owner, 2026-11-24:
 * chatbots bring direct customers; "the goal is to bring us as many people as
 * possible"). GPTBot, Reflectionbot, Googlebot… crawl these pages freely, and
 * robots.txt does not close them (app/robots.js).
 *
 * What IS refused: a FILTERED directory request from an anonymous script
 * wearing Chrome's name — a user agent that says Chrome, names no bot, sent
 * no `Sec-Fetch-Mode` and does not come from Meta's network. That day one
 * such scraper rotated ten Chrome versions from 30 addresses. Real Chrome has
 * sent Sec-Fetch-Mode on every navigation and fetch since version 76 (2019),
 * Android WebViews included; iOS Chrome says "CriOS" and is not matched.
 * Googlebot and Bingbot DO put "Chrome/" in their user agent and send no
 * Sec-Fetch headers — they carry a bot token, which is why that exemption
 * comes first. A person caught by mistake gets a short page with a link to
 * the unfiltered directory; nothing outside filtered /agents is ever touched.
 */
import { clientIpFromHeaders } from './clientIp';

/** Query keys that make a directory URL a filtered one (lib/agentDirectoryRules.js). */
export const DIRECTORY_FILTER_KEYS = ['q', 'nom', 'ville', 'communes', 'commune', 'pres', 'offre', 'verifies', 'tri'];

const DIRECTORY_PATHS = new Set(['/agents', '/en/agents']);

/**
 * A user agent that names itself as a crawler, search engine, AI assistant or
 * link preview. Broad on purpose: letting a scraper through costs a query,
 * refusing a search engine costs visitors.
 */
const NAMED_CRAWLER = /bot\b|bot\/|crawl|spider|slurp|google|bing|yandex|baidu|duckduck|qwant|ecosia|seznam|petal|naver|sogou|yahoo|applebot|openai|chatgpt|gptbot|oai-|claude|anthropic|perplexity|cohere|mistral|meta-|facebook|whatsapp|telegram|twitter|linkedin|slack|discord|skype|pinterest|embedly|preview|lighthouse|pagespeed|headlesschrome\b.*\b(google|bing)|compatible;/i;

/**
 * Meta's own network (AS32934): Meta AI, its crawler and the link-preview
 * fetchers of Facebook / WhatsApp / Instagram — the site's main ad channel.
 * One of them crawled /agents with a plain Chrome user agent on 2026-11-24.
 */
const META_V4 = [
  '31.13.24.0/21', '31.13.64.0/18', '45.64.40.0/22', '57.141.0.0/16', '66.220.144.0/20', '69.63.176.0/20',
  '69.171.224.0/19', '74.119.76.0/22', '102.132.96.0/20', '103.4.96.0/22', '129.134.0.0/16', '157.240.0.0/16',
  '163.70.128.0/17', '173.252.64.0/18', '179.60.192.0/22', '185.60.216.0/22', '185.89.216.0/22', '204.15.20.0/22',
];
const META_V6_PREFIXES = ['2a03:2880:', '2620:0:1c'];

function v4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

const META_V4_RANGES = META_V4.map((cidr) => {
  const [base, len] = cidr.split('/');
  const bits = Number(len);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (v4ToInt(base) & mask) >>> 0, mask };
});

/** Is this address in Meta's network? */
export function isMetaAddress(raw) {
  const ip = String(raw || '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (!ip) return false;
  if (ip.includes(':')) return META_V6_PREFIXES.some((p) => ip.startsWith(p));
  const n = v4ToInt(ip);
  return n !== null && META_V4_RANGES.some((r) => ((n & r.mask) >>> 0) === r.net);
}

/** `/agents` or `/en/agents` with at least one filter in the query (page alone is not a filter). */
export function isFilteredDirectoryRequest(pathname, searchParams) {
  if (!DIRECTORY_PATHS.has(String(pathname || '').replace(/\/+$/, '') || '/')) return false;
  if (!searchParams || typeof searchParams.has !== 'function') return false;
  return DIRECTORY_FILTER_KEYS.some((key) => searchParams.has(key));
}

/** Names itself as a crawler, search engine, AI assistant or preview fetcher. */
export function isNamedCrawler(userAgent) {
  return NAMED_CRAWLER.test(String(userAgent || ''));
}

/**
 * An anonymous script wearing Chrome's name: says Chrome, names no bot, sent
 * no Sec-Fetch-Mode, and does not come from Meta's network. `headers` is a
 * Headers object (or anything with get()).
 */
export function looksLikeImpersonatedChrome(headers) {
  const get = (name) => {
    try {
      return headers?.get?.(name) || '';
    } catch {
      return '';
    }
  };
  const ua = get('user-agent');
  if (!/\bChrome\/\d+/.test(ua) || /\bCriOS\//.test(ua)) return false;
  if (isNamedCrawler(ua)) return false;
  if (get('sec-fetch-mode')) return false;
  if (isMetaAddress(clientIpFromHeaders(headers))) return false;
  return true;
}

/** The answer a turned-away request gets: small, not cached, not indexed. */
export const CRAWL_REFUSAL = {
  status: 403,
  body:
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">' +
    '<title>Lukka Place</title>' +
    '<p>Cette recherche dans l’annuaire n’est pas disponible pour les accès automatisés.</p>' +
    '<p><a href="/agents">Voir l’annuaire des agents</a></p>',
  headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    'x-lukka-crawl-guard': 'directory-filters',
  },
};
