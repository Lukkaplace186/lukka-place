import { SITE_URL } from '@/lib/constants';

/**
 * Crawlers that harvest content into datasets, image collections or SEO
 * databases anyone can buy or download, banned from the whole site
 * (2026-11-05, owner: no scraping — /conditions, article 7). robots.txt is a
 * request, not a lock: well-behaved bots obey it, and article 7.3 says that
 * obeying or ignoring it grants nobody any right.
 *
 * Deliberately NOT a "block everyone but Google and Bing" allow-list: the
 * link-preview bots (WhatsApp, Facebook, X, LinkedIn) read robots.txt too, and
 * blocking them would strip the photo card from every listing link agents
 * share — the main way listings travel. Add a name here when a new harvester
 * shows up in the logs.
 *
 * AI ASSISTANTS ARE DELIBERATELY NOT HERE (owner, 2026-11-05): someone asking
 * ChatGPT, Claude, Gemini, Perplexity, Meta AI, Apple or DuckDuckGo for an
 * apartment in Kinshasa should be pointed at Lukka Place. Their crawlers
 * (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User,
 * Google-Extended, PerplexityBot, Perplexity-User, meta-externalagent,
 * FacebookBot, Applebot-Extended, DuckAssistBot, MistralAI-User, YouBot…)
 * fall under '*'. What stays banned is a dataset or harvester with no
 * assistant sending people back to us.
 */
const BLOCKED_CRAWLERS = [
  // Open datasets and image harvesters (copied wholesale, no visitors back)
  'CCBot', // Common Crawl: a public dump anyone downloads
  'cohere-training-data-crawler',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'Diffbot', // sells extracted data
  'omgili',
  'omgilibot',
  'Timpibot',
  'ImagesiftBot', // image collections — the listing photos
  'img2dataset',
  'Bytespider', // ByteDance: known to crawl far harder than its share of visitors
  // Bulk SEO / data harvesters
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DotBot',
  'DataForSeoBot',
  'BLEXBot',
  'SeekportBot',
  'magpie-crawler',
];

/**
 * NOTHING PUBLIC IS CLOSED TO SEARCH ENGINES OR AI ASSISTANTS (owner,
 * 2026-11-24): "the goal is to bring us as many people as possible". On that
 * day `/agents?…` filter pages were disallowed here for a few hours to cut the
 * database load GPTBot put on them; the owner reverted it — chatbots bring
 * direct customers. When a crawler is expensive, make the page cheaper; only
 * scrapers that impersonate a browser are turned away
 * (lib/directoryCrawlGuard.js), never a crawler that names itself.
 */
export default function robots() {
  const base = SITE_URL.replace(/\/+$/, '');
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/admin', '/compte', '/api/', '/r/', '/messages'] },
      { userAgent: BLOCKED_CRAWLERS, disallow: '/' },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
