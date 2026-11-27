/**
 * One request said twice (2026-11-11, visits #21/#22: the same customer asked
 * for the same listing twice, a minute apart). /admin/viewings shows the
 * copies as copies of one request instead of two unrelated rows.
 *
 * - `duplicateOf`: the engine closed this row as a copy of that id when the
 *   agent answered it (viewing_requests.duplicate_of).
 * - `possibleDuplicateOf`: older rows the engine never closed — same customer,
 *   same listing, this one still waiting, another one on the page. Points at
 *   the answered one, else the newest.
 * - `copies`: on the request that stands, the ids of its copies on this page.
 *
 * Pure, so it is tested without a database. Only rows on the current page are
 * compared; a copy on another page is still marked by its own duplicate_of.
 */

const WAITING = new Set(['PENDING', 'RESCHEDULED']);

function keyOf(row) {
  const wa = String(row?.lead_wa_id || '').replace(/\D/g, '');
  return wa && row?.property_id != null ? `${wa}|${row.property_id}` : null;
}

export function viewingGroups(rows = []) {
  const result = new Map();
  const entry = (id) => {
    if (!result.has(id)) result.set(id, { duplicateOf: null, possibleDuplicateOf: null, copies: [] });
    return result.get(id);
  };
  const ids = new Set(rows.map((row) => Number(row.id)));

  for (const row of rows) {
    const id = Number(row.id);
    entry(id);
    const of = row.duplicate_of != null ? Number(row.duplicate_of) : null;
    if (of) {
      entry(id).duplicateOf = of;
      if (ids.has(of)) entry(of).copies.push(id);
    }
  }

  const byKey = new Map();
  for (const row of rows) {
    if (row.duplicate_of != null) continue;
    const key = keyOf(row);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const answered = group.filter((row) => row.first_response_at);
    const pool = answered.length ? answered : group;
    const lead = pool.reduce((best, row) => (Number(row.id) > Number(best.id) ? row : best));
    for (const row of group) {
      if (row === lead || !WAITING.has(row.status)) continue;
      entry(Number(row.id)).possibleDuplicateOf = Number(lead.id);
      entry(Number(lead.id)).copies.push(Number(row.id));
    }
  }

  for (const value of result.values()) value.copies.sort((a, b) => a - b);
  return result;
}
