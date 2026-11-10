/**
 * services/portalAlerts.js
 *
 * Standard property-portal alerts for customers with the Lukka Place app
 * (app plan part 2 phase 3, 2026-11-10). App only (push, category
 * `search_alerts` / `suggestions`), never WhatsApp: no template covers them
 * and the owner chose app-only for discovery alerts.
 *
 *   C1  instant match — job `instant-alerts`, every 10 minutes, runs web's
 *       /api/cron/instant-alerts (web owns saved searches and the matching,
 *       exactly as the daily `search-alerts` job does).
 *   C3  similar listings — after a visit took place (visitReceipt) and when
 *       a saved listing is let or sold (favoriteStatus): a push opening a
 *       /listings search for the same commune, type of deal and budget.
 *   C7  "Toujours en recherche ?" — job `search-checkup`, Mondays 10 h
 *       Kinshasa: a saved search active for 30+ days, asked once per 60 days.
 *
 * C8 (new photos on a saved listing) lives in services/favoriteStatus.js.
 *
 * The rest are computed by web (lib/portalDigests.js, /api/cron/portal-alerts),
 * which owns saved searches, favourites, projects and the price guide; these
 * jobs only call it on time:
 *   C2 + C5  job `portal-daily`, 12 h Kinshasa: price cuts on listings the
 *            customer visited or enquired about (this engine sends the
 *            wa_id × listing pairs from its SQLite, last 60 days), then new
 *            projects in the communes they search.
 *   C9       job `weekly-summary`, Sundays 18 h.
 *   C6       job `monthly-market`, the 1st of the month, 10 h.
 * C4 (new listings from a followed agency) rides on `instant-alerts`.
 */

const postgres = require('./postgres');
const pushNotify = require('./pushNotify');

const INSTANT_JOB = 'instant-alerts';
const CHECKUP_JOB = 'search-checkup';
const CHECKUP_AFTER_DAYS = 30;
const CHECKUP_EVERY_DAYS = 60;

function off(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'off';
}

function webBaseUrl() {
  return (process.env.WEB_BASE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// C1 — instant match (the work is web's)
// ---------------------------------------------------------------------------

async function runInstantAlerts({ fetchImpl = fetch } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set — the instant-alerts endpoint would reject this call');
  const response = await fetchImpl(`${webBaseUrl()}/api/cron/instant-alerts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`instant-alerts returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (body.pushed) console.log(`[instant-alerts] ${body.pushed} search(es) pushed, ${body.capped || 0} capped`);
  return { newListings: body.newListings || 0, searches: body.searches || 0, pushed: body.pushed || 0, capped: body.capped || 0 };
}

const instantAlertsJob = {
  name: INSTANT_JOB,
  // Minute 5, 15, 25…: not the same tick as request-followup (0, 10, 20…).
  shouldRun: (now = new Date()) => !off('INSTANT_ALERTS') && Boolean(process.env.CRON_SECRET) && now.getUTCMinutes() % 10 === 5,
  run: () => runInstantAlerts(),
};

// ---------------------------------------------------------------------------
// C3 — similar listings
// ---------------------------------------------------------------------------

/**
 * A /listings search like this listing: its commune, its kind of deal, up to
 * 30 % above its price. Only what the listing states; null without a commune.
 */
function similarListingsPath(listing) {
  const commune = String(listing?.commune || '').trim();
  if (!commune) return null;
  const params = new URLSearchParams();
  params.set('commune', commune);
  const purpose = String(listing?.purpose || '').toLowerCase();
  if (purpose === 'sale' || purpose === 'vente') params.set('transaction_type', 'vente');
  else if (purpose === 'rent' || purpose === 'location') params.set('transaction_type', 'location');
  const price = Number(listing?.price);
  if (Number.isFinite(price) && price > 0) params.set('price_max', String(Math.round(price * 1.3)));
  return `/listings?${params.toString()}`;
}

/**
 * Push "biens similaires" to a customer (by account or phone). App only;
 * nothing without a commune to search in. Never throws.
 * @param {'after_visit'|'saved_let'} reason
 */
async function suggestSimilar({ customerId, phone, listing, reason, refId }) {
  const url = similarListingsPath(listing);
  if (!url || off('SIMILAR_SUGGESTIONS')) return { pushed: false, reason: 'no-suggestion' };
  const where = listing.commune ? ` à ${listing.commune}` : '';
  const copy = reason === 'after_visit'
    ? { title: 'D’autres biens à voir', body: `Des biens comparables à celui que vous avez visité${where}.` }
    : { title: 'Des biens similaires sont disponibles', body: `Le bien que vous aviez enregistré n’est plus libre : voici des biens comparables${where}.` };
  return pushNotify.pushOnly({
    userType: 'customer',
    customerId,
    phone,
    kind: 'similar_listings',
    category: 'suggestions',
    refId,
    ...copy,
    url,
  });
}

// ---------------------------------------------------------------------------
// C7 — "Toujours en recherche ?"
// ---------------------------------------------------------------------------

const CHECKUP_SQL = `
  SELECT DISTINCT ON (css.customer_id) css.id, css.customer_id, css.label, css.created_at
    FROM customer_saved_searches css
   WHERE COALESCE(to_jsonb(css) ->> 'alert_frequency', 'daily') <> 'off'
     AND css.created_at < now() - make_interval(days => ${CHECKUP_AFTER_DAYS})
     AND EXISTS (SELECT 1 FROM push_devices d
                  WHERE d.user_type = 'customer' AND d.user_id = css.customer_id AND d.revoked_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM notifications n
                      WHERE n.user_type = 'customer' AND n.user_id = css.customer_id
                        AND n.kind = 'search_checkup' AND n.ref_id = css.id::text
                        AND n.created_at > now() - make_interval(days => ${CHECKUP_EVERY_DAYS}))
   ORDER BY css.customer_id, css.created_at
   LIMIT 500`;

/** One question per customer per run, about their oldest active search. */
async function runSearchCheckup({ pool, push = pushNotify.pushOnly } = {}) {
  const summary = { due: 0, pushed: 0 };
  if (off('SEARCH_CHECKUP')) return { ...summary, skipped: 'off' };
  const db = pool || (postgres.isConfigured() ? postgres.getPool() : null);
  if (!db) return { ...summary, skipped: 'no-postgres' };
  let rows;
  try {
    ({ rows } = await db.query(CHECKUP_SQL));
  } catch (err) {
    if (err?.code === '42P01') return { ...summary, skipped: 'no-table' };
    throw err;
  }
  summary.due = rows.length;
  for (const row of rows) {
    const days = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000);
    const label = String(row.label || 'votre recherche').slice(0, 60);
    const outcome = await push({
      userType: 'customer',
      customerId: row.customer_id,
      kind: 'search_checkup',
      category: 'search_alerts',
      refId: String(row.id),
      title: 'Toujours en recherche ?',
      body: `Votre alerte « ${label} » est active depuis ${days} jours. Mettez-la à jour ou en pause en un geste.`,
      url: '/compte/client/favoris?tab=alertes',
    });
    if (outcome?.pushed) summary.pushed += 1;
  }
  return summary;
}

function checkupDue(now = new Date()) {
  if (off('SEARCH_CHECKUP')) return false;
  // Mondays, 10 h Kinshasa (09 h UTC).
  if (now.getUTCDay() !== 1 || now.getUTCHours() !== 9) return false;
  // eslint-disable-next-line global-require
  const last = require('./db').getLastJobRun(CHECKUP_JOB);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= 6 * 86_400_000;
}

const searchCheckupJob = { name: CHECKUP_JOB, shouldRun: checkupDue, run: () => runSearchCheckup() };

// ---------------------------------------------------------------------------
// C2 / C5 / C9 / C6 — scheduled calls to web
// ---------------------------------------------------------------------------

const ENQUIRED_LOOKBACK_DAYS = 60;

async function callPortalTask(task, extra = {}, { fetchImpl = fetch } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET is not set — the portal-alerts endpoint would reject this call');
  const response = await fetchImpl(`${webBaseUrl()}/api/cron/portal-alerts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, ...extra }),
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(`${task} returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/** SQLite's 'YYYY-MM-DD HH:MM:SS' (UTC) or an ISO string → ISO. */
function isoOf(value) {
  const text = String(value || '');
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Every listing a customer showed interest in over the last 60 days — an
 * enquiry about it or a visit request — with when, so web only counts a cut
 * made after that. At most 5000 pairs, newest first.
 */
function enquiredPairs(now = new Date()) {
  // eslint-disable-next-line global-require
  const { db } = require('./db');
  const since = new Date(now.getTime() - ENQUIRED_LOOKBACK_DAYS * 86_400_000);
  const sinceSql = since.toISOString().replace('T', ' ').slice(0, 19);
  const rows = db
    .prepare(
      `SELECT wa_id, property_id, created_at FROM leads
        WHERE property_id IS NOT NULL AND wa_id IS NOT NULL AND created_at > ?
       UNION ALL
       SELECT l.wa_id, v.property_id, v.created_at FROM viewing_requests v JOIN leads l ON l.id = v.lead_id
        WHERE v.property_id IS NOT NULL AND v.created_at > ?
       ORDER BY created_at DESC
       LIMIT 5000`,
    )
    // Both tables stamp created_at with SQLite's CURRENT_TIMESTAMP shape.
    .all(sinceSql, sinceSql);
  const seen = new Set();
  const pairs = [];
  for (const row of rows) {
    const waId = String(row.wa_id || '').replace(/\D/g, '');
    const key = `${waId}:${row.property_id}`;
    const at = isoOf(row.created_at);
    if (!waId || !at || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ waId, propertyId: Number(row.property_id), since: at });
  }
  return pairs;
}

async function runPortalDaily({ fetchImpl = fetch, now = new Date() } = {}) {
  const pairs = enquiredPairs(now);
  const drops = await callPortalTask('enquired-price-drops', { pairs }, { fetchImpl });
  const projects = await callPortalTask('new-projects', {}, { fetchImpl });
  return { pairs: pairs.length, dropsPushed: drops.pushed || 0, projectsPushed: projects.pushed || 0 };
}

/** Once a day (20 h gap) at a Kinshasa hour, optionally on a weekday / day of month. */
function dueAt(name, { hour, weekday = null, monthDay = null, gapMs = 20 * 3600 * 1000, flag }, now = new Date()) {
  if (off(flag) || !process.env.CRON_SECRET) return false;
  if (now.getUTCHours() !== (hour + 23) % 24) return false;
  const kinshasa = new Date(now.getTime() + 3600 * 1000);
  if (weekday != null && kinshasa.getUTCDay() !== weekday) return false;
  if (monthDay != null && kinshasa.getUTCDate() !== monthDay) return false;
  // eslint-disable-next-line global-require
  const last = require('./db').getLastJobRun(name);
  if (!last?.succeeded_at) return true;
  return Date.now() - new Date(last.succeeded_at).getTime() >= gapMs;
}

const portalDailyJob = {
  name: 'portal-daily',
  shouldRun: (now) => dueAt('portal-daily', { hour: 12, flag: 'PORTAL_DAILY' }, now),
  run: () => runPortalDaily(),
};
const weeklySummaryJob = {
  name: 'weekly-summary',
  shouldRun: (now) => dueAt('weekly-summary', { hour: 18, weekday: 0, gapMs: 6 * 86_400_000, flag: 'WEEKLY_SUMMARY' }, now),
  run: () => callPortalTask('weekly-summary'),
};
const monthlyMarketJob = {
  name: 'monthly-market',
  shouldRun: (now) => dueAt('monthly-market', { hour: 10, monthDay: 1, gapMs: 20 * 86_400_000, flag: 'MONTHLY_MARKET' }, now),
  run: () => callPortalTask('monthly-market'),
};

module.exports = {
  portalDailyJob,
  weeklySummaryJob,
  monthlyMarketJob,
  runPortalDaily,
  callPortalTask,
  enquiredPairs,
  dueAt,
  instantAlertsJob,
  runInstantAlerts,
  suggestSimilar,
  similarListingsPath,
  runSearchCheckup,
  searchCheckupJob,
  CHECKUP_SQL,
};
