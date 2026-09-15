/**
 * Every commune a lead names, primary first — the web read of the engine's
 * `leads.communes` (a JSON array; see services/leadCommunes.js in the engine
 * repo, whose `leadCommunes()` this mirrors). Rows that only ever named one
 * commune carry `communes: null`, and read as `[commune]`.
 *
 * Plain module (no server-only) so both the portal's Server Components and
 * the unit tier can use it.
 *
 * @param {{commune?: string|null, communes?: string|string[]|null}} lead
 * @returns {string[]}
 */
export function parseLeadCommunes(lead) {
  if (!lead) return [];
  let list = [];
  if (Array.isArray(lead.communes)) {
    list = lead.communes;
  } else if (typeof lead.communes === 'string' && lead.communes) {
    try {
      const parsed = JSON.parse(lead.communes);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const clean = list.filter((c) => typeof c === 'string' && c.trim());
  if (clean.length > 0) return clean;
  return lead.commune ? [lead.commune] : [];
}

/**
 * How many communes one request may name. The engine enforces the same cap
 * (MAX_LEAD_COMMUNES); each commune is one ranking query at dispatch, and a
 * request naming half the city is no longer a targeted search.
 */
export const MAX_REQUEST_COMMUNES = 5;
