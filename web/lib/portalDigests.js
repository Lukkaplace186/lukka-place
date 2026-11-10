import 'server-only';
import { getPool } from './db';
import { PRICE_DROP_LATERAL } from './listings';
import { PERCENT_BAND_SQL } from './favoritePriceDrops';
import { getPriceGuides } from './browseFeatures';
import { formatPrice } from './format';

/**
 * The rest of the standard portal alerts (app plan part 2 phase 3,
 * 2026-11-10), for customers with the Lukka Place app only — every query
 * reads customers with a live push_devices row, and every send is a push
 * (`push`, normally lib/adminApi.js pushToAccount), never WhatsApp.
 * Repeats are prevented by the `notifications` rows the pushes themselves
 * write (kind + ref_id), so no bookkeeping table is needed.
 *
 *   C2  a price cut on a listing the customer visited or enquired about
 *       (the engine sends the wa_id × listing pairs from its SQLite)
 *   C9  the weekly summary (Sunday)
 *   C6  the monthly price report for the customer's communes
 *   C5  a new project in a commune the customer searches
 *   C4  a new listing from an agency the customer follows (instant sweep)
 *
 * Run by /api/cron/portal-alerts (C2, C9, C6, C5) and
 * /api/cron/instant-alerts (C4), both called by the engine's scheduler.
 */

const MISSING = new Set(['42P01', '42703']);
const HAS_APP = (alias) => `EXISTS (SELECT 1 FROM push_devices d
   WHERE d.user_type = 'customer' AND d.user_id = ${alias} AND d.revoked_at IS NULL)`;
const NOT_TOLD = (alias, kind, refSql, days = null) => `NOT EXISTS (SELECT 1 FROM notifications n
   WHERE n.user_type = 'customer' AND n.user_id = ${alias} AND n.kind = '${kind}'
     ${refSql ? `AND n.ref_id = ${refSql}` : ''}
     ${days ? `AND n.created_at > now() - interval '${days} days'` : ''})`;

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

async function safeRows(sql, params = []) {
  try {
    const { rows } = await getPool().query(sql, params);
    return rows;
  } catch (err) {
    if (MISSING.has(err?.code)) return [];
    throw err;
  }
}

/** Communes a saved-search query names (`commune`, `communes`). */
export function searchCommunes(query) {
  const params = new URLSearchParams(String(query || ''));
  const out = [];
  for (const value of [params.get('commune'), ...String(params.get('communes') || '').split(',')]) {
    const name = String(value || '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// C2 — price cut on a listing visited or enquired about
// ---------------------------------------------------------------------------

export const ENQUIRED_DROPS_SQL = `
  WITH pairs AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(wa_id text, property_id bigint, since timestamptz)
  )
  SELECT DISTINCT ON (c.id, p.id)
         c.id AS customer_id, p.id AS property_id, pc.title, p.price, p.purpose, p.price_period,
         pd.price_drop_from, pd.price_drop_at,
         p.id::text || ':' || to_char(pd.price_drop_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI') AS ref_key
    FROM pairs x
    JOIN customers c ON c.phone = x.wa_id
    JOIN properties p ON p.id = x.property_id AND p.status = 1 AND p.approve_status = 1
    ${PRICE_DROP_LATERAL}
    LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
   WHERE pd.price_drop_from IS NOT NULL
     AND ${PERCENT_BAND_SQL}
     AND pd.price_drop_at > x.since
     AND COALESCE(p.listing_status, 'active') = 'active'
     AND ${HAS_APP('c.id')}
     -- A saved listing's cut is the favourites' own message (lib/favoritePriceDropSweep.js).
     AND NOT EXISTS (SELECT 1 FROM customer_favorites cf WHERE cf.customer_id = c.id AND cf.property_id = p.id)
     AND ${NOT_TOLD('c.id', 'enquired_price_drop', "p.id::text || ':' || to_char(pd.price_drop_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI')")}
   ORDER BY c.id, p.id, pd.price_drop_at DESC
   LIMIT 500`;

/**
 * @param {{pairs: Array<{waId: string, propertyId: number, since: string}>, push: Function}} input
 */
export async function runEnquiredPriceDrops({ pairs = [], push }) {
  const clean = pairs
    .map((p) => ({ wa_id: String(p.waId || '').replace(/\D/g, ''), property_id: Number(p.propertyId), since: p.since }))
    .filter((p) => /^\d{7,15}$/.test(p.wa_id) && Number.isSafeInteger(p.property_id) && p.property_id > 0 && !Number.isNaN(new Date(p.since).getTime()))
    .slice(0, 5000);
  const result = { pairs: clean.length, found: 0, pushed: 0 };
  if (!clean.length) return result;
  const rows = await safeRows(ENQUIRED_DROPS_SQL, [JSON.stringify(clean)]);
  result.found = rows.length;
  for (const row of rows) {
    const { pushed } = await push({
      userType: 'customer',
      userId: Number(row.customer_id),
      kind: 'enquired_price_drop',
      category: 'suggestions',
      refId: row.ref_key,
      title: 'Baisse de prix sur un bien qui vous intéresse',
      body: clip(`${row.title || `Annonce n° ${row.property_id}`} : ${formatPrice(row.price_drop_from, row.purpose, row.price_period)} → ${formatPrice(row.price, row.purpose, row.price_period)}`, 200),
      url: `/listings/${row.property_id}`,
    });
    if (pushed) result.pushed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// C9 — weekly summary
// ---------------------------------------------------------------------------

export const WEEKLY_SQL = `
  SELECT c.id AS customer_id,
         (SELECT COUNT(*) FROM saved_search_notifications ssn
            JOIN customer_saved_searches css ON css.id = ssn.saved_search_id
           WHERE css.customer_id = c.id AND ssn.notified_at > now() - interval '7 days')::int AS matches,
         (SELECT COUNT(*) FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
           WHERE t.customer_id = c.id AND m.id > t.customer_last_read_id
             AND m.sender_role = 'agent' AND m.deleted_at IS NULL)::int AS unread,
         (SELECT COUNT(*) FROM customer_favorites cf WHERE cf.customer_id = c.id)::int AS saved
    FROM customers c
   WHERE ${HAS_APP('c.id')}
     AND ${NOT_TOLD('c.id', 'weekly_summary', null, 6)}
   ORDER BY c.id
   LIMIT 5000`;

/** The summary's line, or null when the week holds nothing to say. */
export function weeklyBody({ matches = 0, unread = 0 }) {
  const parts = [];
  if (matches > 0) parts.push(matches > 1 ? `${matches} nouveaux biens pour vos recherches` : '1 nouveau bien pour vos recherches');
  if (unread > 0) parts.push(unread > 1 ? `${unread} messages non lus` : '1 message non lu');
  return parts.length ? `${parts.join(' · ')}.` : null;
}

export async function runWeeklySummary({ push }) {
  const rows = await safeRows(WEEKLY_SQL);
  const result = { customers: rows.length, pushed: 0, quiet: 0 };
  for (const row of rows) {
    const body = weeklyBody(row);
    if (!body) {
      result.quiet += 1;
      continue;
    }
    const { pushed } = await push({
      userType: 'customer',
      userId: Number(row.customer_id),
      kind: 'weekly_summary',
      category: 'news',
      title: 'Votre semaine sur Lukka Place',
      body,
      url: '/compte/client',
    });
    if (pushed) result.pushed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// C6 — monthly price report
// ---------------------------------------------------------------------------

export const APP_SEARCHES_SQL = `
  SELECT css.customer_id, css.query
    FROM customer_saved_searches css
   WHERE ${HAS_APP('css.customer_id')}
   ORDER BY css.customer_id, css.created_at DESC
   LIMIT 10000`;

/** One guide per customer: the first commune they search that the price guide covers (2 bedrooms first). */
export function pickGuide(communes, guides) {
  for (const commune of communes) {
    const forCommune = guides.filter((g) => String(g.commune).toLowerCase() === commune.toLowerCase());
    if (forCommune.length) return forCommune.find((g) => Number(g.beds) === 2) || forCommune[0];
  }
  return null;
}

export async function runMonthlyMarket({ push, guides = null }) {
  const allGuides = guides || (await getPriceGuides());
  const result = { customers: 0, pushed: 0, noGuide: 0 };
  if (!allGuides.length) return { ...result, skipped: 'no-guides' };
  const rows = await safeRows(APP_SEARCHES_SQL);
  const byCustomer = new Map();
  for (const row of rows) {
    const list = byCustomer.get(row.customer_id) || [];
    for (const c of searchCommunes(row.query)) if (!list.includes(c)) list.push(c);
    byCustomer.set(row.customer_id, list);
  }
  const told = new Set((await safeRows(
    `SELECT DISTINCT user_id FROM notifications
      WHERE user_type = 'customer' AND kind = 'monthly_market' AND created_at > now() - interval '25 days'`,
  )).map((r) => Number(r.user_id)));
  for (const [customerId, communes] of byCustomer) {
    if (told.has(Number(customerId))) continue;
    result.customers += 1;
    const guide = pickGuide(communes, allGuides);
    if (!guide) {
      result.noGuide += 1;
      continue;
    }
    const { pushed } = await push({
      userType: 'customer',
      userId: Number(customerId),
      kind: 'monthly_market',
      category: 'news',
      refId: guide.slug,
      title: `Les loyers à ${guide.commune} ce mois-ci`,
      body: `${guide.beds > 1 ? `${guide.beds} chambres` : `${guide.beds} chambre`} : loyer médian ${guide.median} $ / mois (de ${guide.p25} à ${guide.p75} $, ${guide.listings} annonces).`,
      url: `/combien-coute/${guide.slug}`,
    });
    if (pushed) result.pushed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// C5 — a new project in a commune the customer searches
// ---------------------------------------------------------------------------

export const NEW_PROJECTS_SQL = `
  SELECT d.id, d.slug, d.name, d.commune
    FROM developments d
   WHERE d.status = 1 AND d.approve_status = 1
     AND d.commune IS NOT NULL
     AND d.created_at > now() - interval '14 days'
   ORDER BY d.created_at DESC
   LIMIT 20`;

export async function runNewProjects({ push }) {
  const projects = await safeRows(NEW_PROJECTS_SQL);
  const result = { projects: projects.length, pushed: 0 };
  if (!projects.length) return result;
  const searches = await safeRows(APP_SEARCHES_SQL);
  const told = new Set((await safeRows(
    `SELECT user_id, ref_id FROM notifications WHERE user_type = 'customer' AND kind = 'new_project' AND created_at > now() - interval '30 days'`,
  )).map((r) => `${r.user_id}:${r.ref_id}`));
  const communesOf = new Map();
  for (const row of searches) {
    const set = communesOf.get(row.customer_id) || new Set();
    for (const c of searchCommunes(row.query)) set.add(c.toLowerCase());
    communesOf.set(row.customer_id, set);
  }
  for (const [customerId, communes] of communesOf) {
    // One project per customer per run: the newest in one of their communes.
    const project = projects.find((p) => communes.has(String(p.commune).toLowerCase()) && !told.has(`${customerId}:${p.id}`));
    if (!project) continue;
    const { pushed } = await push({
      userType: 'customer',
      userId: Number(customerId),
      kind: 'new_project',
      category: 'suggestions',
      refId: String(project.id),
      title: `Nouveau projet à ${project.commune}`,
      body: clip(`${project.name} : découvrez les logements et le plan de paiement.`, 200),
      url: `/projets/${project.slug}`,
    });
    if (pushed) result.pushed += 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// C4 — a new listing from a followed agency (run by the instant sweep)
// ---------------------------------------------------------------------------

export const FOLLOWED_SQL = `
  SELECT f.customer_id, p.id AS property_id, p.agent_id, pc.title, p.price, p.purpose, p.price_period
    FROM customer_follows f
    JOIN properties p ON p.agent_id = f.agent_id AND p.status = 1 AND p.approve_status = 1
    LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
   WHERE p.id = ANY($1::bigint[])
     AND f.created_at < GREATEST(p.created_at, COALESCE(NULLIF(to_jsonb(p) ->> 'moderated_at', '')::timestamptz, p.created_at))
     AND ${HAS_APP('f.customer_id')}
     AND ${NOT_TOLD('f.customer_id', 'followed_agent_listing', 'p.id::text')}
   LIMIT 500`;

export async function runFollowedAgentListings({ recentIds = [], push }) {
  const ids = recentIds.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  const result = { listings: ids.length, pushed: 0 };
  if (!ids.length) return result;
  const rows = await safeRows(FOLLOWED_SQL, [ids]);
  for (const row of rows) {
    const { pushed } = await push({
      userType: 'customer',
      userId: Number(row.customer_id),
      kind: 'followed_agent_listing',
      category: 'suggestions',
      refId: String(row.property_id),
      title: 'Nouvelle annonce d’une agence que vous suivez',
      body: clip(`${row.title || `Annonce n° ${row.property_id}`} — ${formatPrice(row.price, row.purpose, row.price_period)}`, 200),
      url: `/listings/${row.property_id}`,
    });
    if (pushed) result.pushed += 1;
  }
  return result;
}
