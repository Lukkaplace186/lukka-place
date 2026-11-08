/**
 * Engine half of the ONE agent-prospect list (market_prospects,
 * migrations/20261105_market_prospects.sql), for adverts the owner pastes to
 * Claude instead of the console (2026-11-08, owner: "when we paste, the
 * asking price goes into the median and the agent's information is collected
 * on the table"). scripts/import-market-observations.js stores the prices
 * (market_observations, still no phone there) and, in the same transaction,
 * the posters here.
 *
 * Duplicated from web (ESM, console): `prospectPhone` = web
 * lib/marketProspectRules.js, `UPSERT_PROSPECT_SQL` / `LINK_SQL` = web
 * lib/marketProspects.js. verify-pipeline §84 compares them — change one,
 * change the other.
 */

/** Digits only, 7–15 (E.164 range); a local 0812… / 812… becomes 243…. */
function prospectPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^0[89]\d{8}$/.test(digits)) return `243${digits.slice(1)}`;
  if (/^[89]\d{8}$/.test(digits)) return `243${digits}`;
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

/**
 * A second paste never overwrites what the team typed: a blank name or
 * agency is filled, the source is added, the advert counted.
 */
const UPSERT_PROSPECT_SQL = `
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

const OBSERVATION_IDS_SQL = 'SELECT id, source_ref FROM market_observations WHERE source = $1 AND source_ref = ANY($2::text[])';

const text = (value, max) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * One poster per number, from the import's rows. Each entry is
 * `{ ref, phone, name, agency, url }` (phone already through prospectPhone);
 * `newRefs` are the adverts this import adds (not already stored), the only
 * ones counted — re-importing a file never inflates a count.
 */
function groupProspects(entries, newRefs = new Set()) {
  const byPhone = new Map();
  for (const e of entries) {
    if (!e?.phone) continue;
    const p = byPhone.get(e.phone) || { phone: e.phone, name: null, agency: null, url: null, adverts: 0, refs: [] };
    p.name = p.name || text(e.name, 120);
    p.agency = p.agency || text(e.agency, 120);
    p.url = p.url || e.url || null;
    if (e.ref) {
      p.refs.push(e.ref);
      if (newRefs.has(e.ref)) p.adverts += 1;
    }
    byPhone.set(e.phone, p);
  }
  return [...byPhone.values()];
}

/**
 * Writes the grouped posters with `client` — the caller's transaction, the
 * same one that stored the prices. Returns the counts the script prints.
 */
async function saveProspects(client, prospects, { source }) {
  const result = { prospectsNew: 0, prospectsUpdated: 0, linked: 0 };
  if (!prospects.length) return result;
  const refs = [...new Set(prospects.flatMap((p) => p.refs))];
  const ids = new Map();
  if (refs.length) {
    const { rows } = await client.query(OBSERVATION_IDS_SQL, [source, refs]);
    for (const row of rows) ids.set(row.source_ref, Number(row.id));
  }
  for (const p of prospects) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await client.query(UPSERT_PROSPECT_SQL, [p.phone, p.name, p.agency, [source], p.url, p.adverts, null]);
    if (rows[0].created) result.prospectsNew += 1; else result.prospectsUpdated += 1;
    for (const ref of p.refs) {
      const observationId = ids.get(ref);
      if (!observationId) continue;
      // eslint-disable-next-line no-await-in-loop
      const linked = await client.query(LINK_SQL, [Number(rows[0].id), observationId]);
      result.linked += linked.rowCount || 0;
    }
  }
  return result;
}

module.exports = {
  prospectPhone,
  UPSERT_PROSPECT_SQL,
  LINK_SQL,
  OBSERVATION_IDS_SQL,
  groupProspects,
  saveProspects,
};
