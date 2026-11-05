import 'server-only';
import { createHash } from 'node:crypto';
import { getPool } from './db';
import { INSERT_MANUAL_SQL } from './marketGuide';
import { mergeSources, pasteRefSeed, PROSPECT_CHANNELS, PROSPECT_STATUSES } from './marketProspectRules';

/**
 * Prospects (agents to recruit) and the batch paste that feeds them together
 * with the price guide. Rules: lib/marketProspectRules.js. Tables: engine
 * migrations/20261105_market_prospects.sql. Console only.
 */

/** A digits-only number that is a live Lukka Place agent account. */
const IS_AGENT_SQL = `EXISTS (
  SELECT 1 FROM agents a
   WHERE regexp_replace(COALESCE(a.phone, ''), '\\D', '', 'g') = mp.phone
     AND (to_jsonb(a) ->> 'deleted_at') IS NULL
)`;

export const KNOWN_PHONES_SQL = `
  SELECT mp.phone, mp.id AS prospect_id, mp.status, false AS is_agent
    FROM market_prospects mp WHERE mp.phone = ANY($1::text[])
  UNION ALL
  SELECT regexp_replace(a.phone, '\\D', '', 'g'), NULL, NULL, true
    FROM agents a
   WHERE regexp_replace(COALESCE(a.phone, ''), '\\D', '', 'g') = ANY($1::text[])
     AND (to_jsonb(a) ->> 'deleted_at') IS NULL
`;

/**
 * For the paste table: which numbers are already on the list, and which are
 * already Lukka Place agents. `{ [phone]: {prospectId, status, isAgent} }`.
 */
export async function knownPhones(phones, { pool = getPool() } = {}) {
  const list = [...new Set((phones || []).filter(Boolean))];
  if (!list.length) return {};
  const { rows } = await pool.query(KNOWN_PHONES_SQL, [list]);
  const out = {};
  for (const row of rows) {
    const entry = out[row.phone] || { prospectId: null, status: null, isAgent: false };
    if (row.prospect_id) { entry.prospectId = Number(row.prospect_id); entry.status = row.status; }
    if (row.is_agent) entry.isAgent = true;
    out[row.phone] = entry;
  }
  return out;
}

const FIND_OBSERVATION_SQL = 'SELECT id FROM market_observations WHERE source = $1 AND source_ref = $2';

/**
 * A second paste never overwrites what the team typed: a blank name or
 * agency is filled, the source is added, the advert counted.
 */
export const UPSERT_PROSPECT_SQL = `
  INSERT INTO market_prospects (phone, name, agency, sources, first_url, adverts_count, last_advert_at, created_by, updated_by)
  VALUES ($1, $2, $3, $4::text[], $5, $6, CASE WHEN $6 > 0 THEN NOW() END, $7, $7)
  ON CONFLICT (phone) DO UPDATE SET
    name = COALESCE(market_prospects.name, EXCLUDED.name),
    agency = COALESCE(market_prospects.agency, EXCLUDED.agency),
    sources = (SELECT ARRAY(SELECT DISTINCT unnest(market_prospects.sources || EXCLUDED.sources))),
    first_url = COALESCE(market_prospects.first_url, EXCLUDED.first_url),
    adverts_count = market_prospects.adverts_count + EXCLUDED.adverts_count,
    last_advert_at = CASE WHEN EXCLUDED.adverts_count > 0 THEN NOW() ELSE market_prospects.last_advert_at END,
    updated_at = NOW(),
    updated_by = EXCLUDED.updated_by
  RETURNING id, (xmax = 0) AS created
`;

const LINK_SQL = `
  INSERT INTO market_prospect_adverts (prospect_id, observation_id) VALUES ($1, $2)
  ON CONFLICT DO NOTHING RETURNING prospect_id
`;

/**
 * Saves one checked batch in ONE transaction. Each item is
 * `{ observation: value|null, prospect: {phone,name,agency}|null }`, already
 * validated. Returns the counts the page reports.
 */
export async function saveMarketPasteBatch(items, { source, sourceUrl = null, recordedBy = null, pool = getPool() } = {}) {
  const client = await pool.connect();
  const result = { pricesSaved: 0, pricesDuplicate: 0, prospectsNew: 0, prospectsUpdated: 0, observationIds: [] };
  try {
    await client.query('BEGIN');
    const prospects = new Map(); // phone → { name, agency, observationIds: Set }
    for (const item of items) {
      let observationId = null;
      let newAdvert = false;
      if (item.observation) {
        const value = item.observation;
        const ref = `paste:${createHash('sha256').update(pasteRefSeed(value, item.prospect?.phone)).digest('hex').slice(0, 32)}`;
        const { rows } = await client.query(INSERT_MANUAL_SQL, [
          value.source, ref, value.source_url, value.posted_at, value.purpose, value.property_kind, value.beds,
          value.furnished, value.price, value.currency, value.price_period, value.monthly_usd, value.price_usd,
          value.commune, value.quartier, value.title, recordedBy,
        ]);
        if (rows[0]) {
          observationId = Number(rows[0].id);
          newAdvert = true;
          result.pricesSaved += 1;
          result.observationIds.push(observationId);
        } else {
          result.pricesDuplicate += 1;
          const found = await client.query(FIND_OBSERVATION_SQL, [value.source, ref]);
          observationId = found.rows[0] ? Number(found.rows[0].id) : null;
        }
      }
      if (item.prospect) {
        const entry = prospects.get(item.prospect.phone) || { name: null, agency: null, adverts: 0, observationIds: new Set() };
        entry.name = entry.name || item.prospect.name;
        entry.agency = entry.agency || item.prospect.agency;
        if (newAdvert) entry.adverts += 1;
        if (observationId) entry.observationIds.add(observationId);
        prospects.set(item.prospect.phone, entry);
      }
    }
    for (const [phone, entry] of prospects) {
      const { rows } = await client.query(UPSERT_PROSPECT_SQL, [
        phone, entry.name, entry.agency, mergeSources([], source), sourceUrl, entry.adverts, recordedBy,
      ]);
      const prospectId = Number(rows[0].id);
      if (rows[0].created) result.prospectsNew += 1; else result.prospectsUpdated += 1;
      for (const observationId of entry.observationIds) await client.query(LINK_SQL, [prospectId, observationId]);
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const PAGE_SIZE_MAX = 100;

/**
 * One page of prospects. `status`: one status, 'open' (still worth a call,
 * the default) or 'all'. `q` matches name, agency, number and notes.
 */
export function buildProspectListQuery({ status = 'open', q = '', source = '', limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status === 'open') where.push(`mp.status IN ('todo', 'noanswer', 'callback', 'interested')`);
  else if (PROSPECT_STATUSES.includes(status)) { params.push(status); where.push(`mp.status = $${params.length}`); }
  const term = String(q || '').trim();
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    const digits = term.replace(/\D/g, '');
    let phoneClause = '';
    if (digits.length >= 4) { params.push(`%${digits}%`); phoneClause = ` OR mp.phone LIKE $${params.length}`; }
    where.push(`(mp.name ILIKE ${p} OR mp.agency ILIKE ${p} OR mp.notes ILIKE ${p}${phoneClause})`);
  }
  if (source) { params.push(source); where.push(`$${params.length} = ANY(mp.sources)`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(limit) || 50));
  params.push(size, Math.max(0, Number(offset) || 0));
  return {
    sql: `
      SELECT mp.*, mp.contacted_on::text AS contacted_on_text, ${IS_AGENT_SQL} AS is_agent,
             COUNT(*) OVER () AS total
        FROM market_prospects mp
        ${whereSql}
       ORDER BY (mp.status = 'todo') DESC, mp.last_advert_at DESC NULLS LAST, mp.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params,
  };
}

export async function listProspects(options = {}, { pool = getPool() } = {}) {
  try {
    const { sql, params } = buildProspectListQuery(options);
    const { rows } = await pool.query(sql, params);
    return {
      available: true,
      total: rows[0] ? Number(rows[0].total) : 0,
      rows: rows.map((row) => ({ ...row, id: Number(row.id), adverts_count: Number(row.adverts_count) })),
    };
  } catch (err) {
    if (err.code === '42P01') return { available: false, total: 0, rows: [] };
    throw err;
  }
}

export const PROSPECT_COUNTS_SQL = 'SELECT status, COUNT(*)::int AS n FROM market_prospects GROUP BY status';

export async function prospectCounts({ pool = getPool() } = {}) {
  try {
    const { rows } = await pool.query(PROSPECT_COUNTS_SQL);
    return Object.fromEntries(rows.map((row) => [row.status, row.n]));
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

export const UPDATE_PROSPECT_SQL = `
  UPDATE market_prospects SET
    status = $2, channel = $3, contacted_on = $4, notes = $5, name = $6, agency = $7,
    updated_at = NOW(), updated_by = $8
  WHERE id = $1
  RETURNING id
`;

/** Validates and saves the team's follow-up on one prospect. */
export async function updateProspect(id, input, updatedBy, { pool = getPool() } = {}) {
  const status = PROSPECT_STATUSES.includes(input.status) ? input.status : null;
  if (!status) return { ok: false, error: 'status' };
  const channel = input.channel ? (PROSPECT_CHANNELS.includes(input.channel) ? input.channel : undefined) : null;
  if (channel === undefined) return { ok: false, error: 'channel' };
  let contactedOn = null;
  if (input.contacted_on) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.contacted_on)) return { ok: false, error: 'date' };
    contactedOn = input.contacted_on;
  }
  const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
  const notes = String(input.notes ?? '').trim().slice(0, 2000) || null;
  const { rows } = await pool.query(UPDATE_PROSPECT_SQL, [
    id, status, channel, contactedOn, notes, clean(input.name, 120), clean(input.agency, 120), updatedBy || null,
  ]);
  return rows[0] ? { ok: true } : { ok: false, error: 'missing' };
}

/** The adverts behind the prospects on a page, newest first. */
export const PROSPECT_ADVERTS_SQL = `
  SELECT mpa.prospect_id, mo.id, mo.source, mo.purpose, mo.property_kind, mo.beds, mo.commune, mo.quartier,
         mo.monthly_usd, mo.price_usd, mo.first_seen_at, mo.excluded_reason
    FROM market_prospect_adverts mpa
    JOIN market_observations mo ON mo.id = mpa.observation_id
   WHERE mpa.prospect_id = ANY($1::bigint[])
   ORDER BY mo.first_seen_at DESC
`;

export async function prospectAdverts(ids, { pool = getPool() } = {}) {
  if (!ids?.length) return {};
  const { rows } = await pool.query(PROSPECT_ADVERTS_SQL, [ids]);
  const out = {};
  for (const row of rows) (out[Number(row.prospect_id)] ||= []).push(row);
  return out;
}
