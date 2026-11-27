/**
 * Which channel a visit came from, for /admin/dashboard/sources (2026-11-16,
 * owner: "click on the views count to see where they come from — Facebook
 * ads? Instagram? ChatGPT? — so we can double down"). Pure: the same rules as
 * a JS function (`trafficChannelOf`, for the detail rows) and as a SQL CASE
 * (`trafficChannelSql`, for the aggregates), both built from the lists below.
 *
 * What a page_views row carries (lib/attribution.js, lib/trackIngest.js):
 *   source         utm_source, else the external referrer's host, else 'direct'
 *   utm_medium     'paid' on our Meta ads, 'partner' on agents' links, …
 *   utm_campaign   Meta ads send {{campaign.id}} (a long number)
 *   click_id_type  fbclid / ttclid / gclid. Facebook adds fbclid to EVERY
 *                  outbound link, organic posts included, so fbclid alone
 *                  says "Facebook", never "an ad". ttclid and gclid are only
 *                  added to ad clicks.
 *   referrer_host  the external site, when the browser said
 *
 * Meta's own URL parameters name the placement in utm_source
 * ({{site_source_name}}): fb, ig, an (Audience Network), msg (Messenger).
 *
 * This differs on purpose from lib/growthRules.js `channelOf` (which counts
 * an fbclid as a paid click, for accounts): here an ad is a paid medium, a
 * Meta campaign id, or an ad-only click id.
 */

export const TRAFFIC_CHANNELS = [
  'meta_ads_facebook', 'meta_ads_instagram', 'meta_ads_other', 'tiktok_ads', 'google_ads',
  'ai', 'facebook', 'instagram', 'tiktok', 'search', 'other_social', 'agents', 'whatsapp',
  'direct', 'other',
];

/** Paid channels — the ones an advert budget buys. */
export const AD_CHANNELS = new Set(['meta_ads_facebook', 'meta_ads_instagram', 'meta_ads_other', 'tiktok_ads', 'google_ads']);

/**
 * One colour per channel for the daily chart. Hex because the chart is SVG
 * fills read in both themes; families: Meta blues, TikTok greys, Google
 * ambers, AI green, agents violet, WhatsApp green, the rest neutral.
 */
export const CHANNEL_COLORS = {
  meta_ads_facebook: '#144FC5',
  meta_ads_instagram: '#C13584',
  meta_ads_other: '#4F7BE0',
  tiktok_ads: '#111827',
  google_ads: '#D97706',
  ai: '#0E9F6E',
  facebook: '#8FB0F0',
  instagram: '#E9A3C9',
  tiktok: '#6B7280',
  search: '#F5C26B',
  other_social: '#A5B4C8',
  agents: '#7C3AED',
  whatsapp: '#25D366',
  direct: '#CBD5E1',
  other: '#E2E8F0',
  // The chart's folded remainder, distinct from Direct's grey.
  rest: '#B8A99A',
};

export const PAID_MEDIUMS = ['paid', 'cpc', 'ppc', 'ads', 'paid_social'];

const FB_TAGS = ['fb', 'facebook', 'facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'meta'];
const IG_TAGS = ['ig', 'instagram', 'instagram.com', 'l.instagram.com'];
const FB_HOSTS = ['facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'mbasic.facebook.com', 'business.facebook.com'];
const IG_HOSTS = ['instagram.com', 'l.instagram.com'];
const TIKTOK_TAGS = ['tiktok', 'tiktok.com', 'vm.tiktok.com'];
const TIKTOK_HOSTS = ['tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'];
const AI_TAGS = [
  'chatgpt', 'chatgpt.com', 'chat.openai.com', 'openai', 'perplexity', 'perplexity.ai', 'gemini',
  'gemini.google.com', 'bard.google.com', 'copilot', 'copilot.microsoft.com', 'claude', 'claude.ai',
  'meta.ai', 'deepseek', 'chat.deepseek.com', 'grok', 'grok.com', 'chat.mistral.ai', 'you.com', 'poe.com',
];
const SEARCH_TAGS = [
  'google', 'bing', 'bing.com', 'duckduckgo', 'duckduckgo.com', 'yahoo', 'search.yahoo.com', 'yahoo.com',
  'yandex', 'yandex.ru', 'ecosia.org', 'qwant.com', 'search.brave.com', 'com.google.android.googlequicksearchbox',
];
/** google.com, google.cd, google.com.hk, google.fr … */
const GOOGLE_HOST_PATTERN = '^google\\.[a-z.]+$';
const OTHER_SOCIAL_TAGS = [
  'youtube', 'youtube.com', 'm.youtube.com', 't.co', 'twitter', 'x', 'x.com', 'linkedin', 'linkedin.com',
  'lnkd.in', 'snapchat', 'telegram', 't.me', 'pinterest', 'threads', 'threads.net', 'lukka_reseaux', 'reseaux_sociaux',
];
/** Our agents' share links and partner codes (lib/listingShareCopy.js SHARE_SOURCES, /i/CODE). */
const AGENT_TAGS = ['agent', 'bio_agent', 'partage_agent', 'wa_status', 'wa_message', 'rapport_proprietaire'];
const WHATSAPP_TAGS = ['whatsapp', 'alerte_whatsapp', 'wa', 'wa.me', 'web.whatsapp.com', 'api.whatsapp.com', 'whatsapp.com'];

const isMetaCampaignId = (campaign) => /^[0-9]{12,}$/.test(campaign || '');

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * @param {{source?: string|null, medium?: string|null, clickIdType?: string|null,
 *          referrerHost?: string|null, campaign?: string|null}} row
 * @returns {string} one of TRAFFIC_CHANNELS
 */
export function trafficChannelOf(row) {
  const s = norm(row?.source);
  const h = norm(row?.referrerHost);
  const m = norm(row?.medium);
  const ct = norm(row?.clickIdType);
  const paid = PAID_MEDIUMS.includes(m) || isMetaCampaignId(norm(row?.campaign));
  const any = (list) => list.includes(s) || list.includes(h);
  const google = s === 'google' || new RegExp(GOOGLE_HOST_PATTERN).test(s) || new RegExp(GOOGLE_HOST_PATTERN).test(h);
  const ig = any(IG_TAGS) || IG_HOSTS.includes(h);
  const fb = FB_TAGS.includes(s) || s.startsWith('fb-') || FB_HOSTS.includes(h);
  const tiktok = any(TIKTOK_TAGS) || TIKTOK_HOSTS.includes(h);

  if (ct === 'gclid') return 'google_ads';
  if (ct === 'ttclid' || (paid && tiktok)) return 'tiktok_ads';
  if (paid && (ig || fb || ct === 'fbclid')) {
    // utm_source is Meta's placement; it wins over the referrer.
    if (IG_TAGS.includes(s)) return 'meta_ads_instagram';
    if (FB_TAGS.includes(s) || s.startsWith('fb-')) return 'meta_ads_facebook';
    if (s === 'an' || s === 'msg' || s === 'messenger') return 'meta_ads_other';
    if (ig) return 'meta_ads_instagram';
    if (fb) return 'meta_ads_facebook';
    return 'meta_ads_other';
  }
  if (paid && google) return 'google_ads';
  if (any(AI_TAGS)) return 'ai';
  if (ig) return 'instagram';
  if (fb || ct === 'fbclid') return 'facebook';
  if (tiktok) return 'tiktok';
  if (google || any(SEARCH_TAGS)) return 'search';
  if (AGENT_TAGS.includes(s) || m === 'partner') return 'agents';
  if (any(WHATSAPP_TAGS)) return 'whatsapp';
  if (any(OTHER_SOCIAL_TAGS)) return 'other_social';
  if ((s === '' || s === 'direct') && h === '') return 'direct';
  return 'other';
}

function sqlList(values) {
  return `ARRAY[${values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ')}]::text[]`;
}

/**
 * The same rules as `trafficChannelOf`, as a SQL expression. Each argument is
 * a SQL expression for that field (e.g. `pv.source`).
 */
export function trafficChannelSql({ source, medium, clickIdType, referrerHost, campaign }) {
  const s = `lower(btrim(COALESCE(${source}, '')))`;
  const h = `lower(btrim(COALESCE(${referrerHost}, '')))`;
  const m = `lower(btrim(COALESCE(${medium}, '')))`;
  const ct = `lower(COALESCE(${clickIdType}, ''))`;
  const c = `btrim(COALESCE(${campaign}, ''))`;
  const inList = (expr, list) => `${expr} = ANY(${sqlList(list)})`;
  const any = (list) => `(${inList(s, list)} OR ${inList(h, list)})`;
  const paid = `(${inList(m, PAID_MEDIUMS)} OR ${c} ~ '^[0-9]{12,}$')`;
  const google = `(${s} = 'google' OR ${s} ~ '${GOOGLE_HOST_PATTERN}' OR ${h} ~ '${GOOGLE_HOST_PATTERN}')`;
  const ig = `(${any(IG_TAGS)} OR ${inList(h, IG_HOSTS)})`;
  const fbTag = `(${inList(s, FB_TAGS)} OR ${s} LIKE 'fb-%')`;
  const fb = `(${fbTag} OR ${inList(h, FB_HOSTS)})`;
  const tiktok = `(${any(TIKTOK_TAGS)} OR ${inList(h, TIKTOK_HOSTS)})`;
  return `(CASE
    WHEN ${ct} = 'gclid' THEN 'google_ads'
    WHEN ${ct} = 'ttclid' OR (${paid} AND ${tiktok}) THEN 'tiktok_ads'
    WHEN ${paid} AND (${ig} OR ${fb} OR ${ct} = 'fbclid') THEN (CASE
      WHEN ${inList(s, IG_TAGS)} THEN 'meta_ads_instagram'
      WHEN ${fbTag} THEN 'meta_ads_facebook'
      WHEN ${s} IN ('an', 'msg', 'messenger') THEN 'meta_ads_other'
      WHEN ${ig} THEN 'meta_ads_instagram'
      WHEN ${fb} THEN 'meta_ads_facebook'
      ELSE 'meta_ads_other' END)
    WHEN ${paid} AND ${google} THEN 'google_ads'
    WHEN ${any(AI_TAGS)} THEN 'ai'
    WHEN ${ig} THEN 'instagram'
    WHEN ${fb} OR ${ct} = 'fbclid' THEN 'facebook'
    WHEN ${tiktok} THEN 'tiktok'
    WHEN ${google} OR ${any(SEARCH_TAGS)} THEN 'search'
    WHEN ${inList(s, AGENT_TAGS)} OR ${m} = 'partner' THEN 'agents'
    WHEN ${any(WHATSAPP_TAGS)} THEN 'whatsapp'
    WHEN ${any(OTHER_SOCIAL_TAGS)} THEN 'other_social'
    WHEN ${s} IN ('', 'direct') AND ${h} = '' THEN 'direct'
    ELSE 'other' END)`;
}

/** Bucket size for the daily chart: hours for 24 h, weeks for "since the start", days otherwise. */
export function trafficBucket(days) {
  if (days === 1) return 'hour';
  if (days === null || days === undefined) return 'week';
  return 'day';
}

/**
 * Change against the period before, as a whole percent; null when there is
 * nothing to compare (no previous window, or nothing in it).
 */
export function changePercent(current, previous) {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** The chart's series: the `limit` biggest channels by visitors, the rest folded into 'rest'. */
export function chartSeries(channelTotals, limit = 6) {
  const ranked = [...channelTotals].filter((row) => row.visitors > 0).sort((a, b) => b.visitors - a.visitors);
  return { shown: ranked.slice(0, limit).map((row) => row.channel), folded: ranked.length > limit };
}

const KINSHASA_OFFSET_MS = 60 * 60 * 1000; // UTC+1 all year, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;

function keyOf(date, bucket) {
  const iso = date.toISOString();
  return bucket === 'hour' ? `${iso.slice(0, 13)}:00` : `${iso.slice(0, 10)}T00:00`;
}

/**
 * Every bucket of the period, oldest first, in the SQL's key format
 * ('YYYY-MM-DDTHH:MM', Kinshasa wall time), so a day with no visit is drawn
 * as an empty bar rather than skipped.
 */
export function bucketKeys({ bucket, days, rows, now = Date.now() }) {
  const local = new Date(now + KINSHASA_OFFSET_MS);
  const keys = [];
  if (bucket === 'hour') {
    for (let i = 24; i >= 0; i -= 1) keys.push(keyOf(new Date(local.getTime() - i * 3600 * 1000), 'hour'));
    return keys;
  }
  if (bucket === 'day') {
    for (let i = days; i >= 0; i -= 1) keys.push(keyOf(new Date(local.getTime() - i * DAY_MS), 'day'));
    return keys;
  }
  const first = rows.map((r) => r.bucket).sort()[0];
  if (!first) return keys;
  const monday = new Date(local.getTime());
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const end = keyOf(monday, 'day');
  for (let d = new Date(`${first.slice(0, 10)}T00:00:00Z`); keyOf(d, 'day') <= end; d = new Date(d.getTime() + 7 * DAY_MS)) {
    keys.push(keyOf(d, 'day'));
  }
  return keys;
}
