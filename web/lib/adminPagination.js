/**
 * URL-driven pagination and filter state for every /admin table.
 *
 * The console is server-rendered: a page, a filter or a search term is a query
 * parameter, the Server Component reads it, and the database returns exactly
 * one page (LIMIT/OFFSET, plus a COUNT for the total). Nothing is fetched
 * whole and sliced in the browser — that is what stops working at 30k agents —
 * and every view stays bookmarkable, the same convention /listings already
 * follows for its own filters.
 *
 * Pure functions, no `server-only`: the client toolbar builds the same URLs.
 */

export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/** Next hands a repeated query param over as an array; the first value wins. */
export function firstParam(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * @param {Record<string, string|string[]|undefined>} params
 * @returns {{page: number, pageSize: number, limit: number, offset: number}}
 */
export function parsePage(params = {}, { pageParam = 'page', sizeParam = 'size', defaultSize = DEFAULT_PAGE_SIZE } = {}) {
  const rawSize = Number.parseInt(firstParam(params?.[sizeParam]), 10);
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : defaultSize;
  const rawPage = Number.parseInt(firstParam(params?.[pageParam]), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1;
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

export function totalPages(total, pageSize) {
  const n = Number(total) || 0;
  return Math.max(1, Math.ceil(n / Math.max(1, pageSize)));
}

/**
 * The query string for `params` with `overrides` applied. Empty values are
 * dropped, so a cleared filter disappears from the URL instead of lingering as
 * `?commune=`. Any override that is not itself a page change resets `page`:
 * narrowing a filter while on page 9 must not land on an empty page 9.
 *
 * @param {string} pathname
 * @param {Record<string, unknown>} params  current (already-parsed) values
 * @param {Record<string, unknown>} [overrides]
 */
export function buildHref(pathname, params = {}, overrides = {}) {
  const merged = { ...params, ...overrides };
  const touchesPage = Object.keys(overrides).some((key) => key === 'page');
  if (!touchesPage && Object.keys(overrides).length > 0) delete merged.page;
  // A cursor belongs to exactly one link — the pager's previous/next arrow that
  // sets it. Any other change (a filter, a sort, a numbered page) drops it.
  if (!CURSOR_PARAMS.some((key) => key in overrides)) {
    for (const key of CURSOR_PARAMS) delete merged[key];
  }

  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(merged)) {
    const value = firstParam(raw);
    if (value === undefined || value === null || value === '') continue;
    if (key === 'page' && Number(value) === 1) continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * KEYSET PAGINATION for the tables that grow without bound (audit log,
 * customers, agents, the listing queue).
 *
 * OFFSET makes page N cost N pages of work, and on a table that is being
 * written to it shifts under the reader: a row inserted while you read page 3
 * pushes the last row of page 3 onto page 4, where you see it twice. The pager's
 * previous/next arrows therefore carry a cursor — the sort key of the row at
 * the edge of the page — and the next page is "rows after that key", an index
 * seek no matter how deep. Jumping to a numbered page still uses OFFSET, which
 * is what makes "page 480 of 1,200" possible at all.
 *
 * A cursor is `[sortValue, id]`, base64url JSON. The sort value is the
 * column's own text form (`created_at::text`), never a JS Date: Postgres keeps
 * microseconds and a Date keeps milliseconds, so a Date round-trip would skip
 * rows created in the same millisecond.
 */
export const CURSOR_PARAMS = ['after', 'before'];

const CURSOR_TS = /^(-?infinity|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?)$/;

function toBase64Url(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/** @param {[string, number|string]} values */
export function encodeCursor(values) {
  if (!Array.isArray(values) || values[0] == null || values[1] == null) return null;
  return toBase64Url(JSON.stringify([String(values[0]), String(values[1])]));
}

/** @returns {[string, string]|null} — null for anything that is not a cursor this module wrote. */
export function decodeCursor(raw) {
  const text = firstParam(raw);
  if (typeof text !== 'string' || text.length === 0 || text.length > 200) return null;
  try {
    const value = JSON.parse(fromBase64Url(text));
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [ts, id] = value;
    if (typeof ts !== 'string' || !CURSOR_TS.test(ts)) return null;
    if (typeof id !== 'string' || !/^\d{1,19}$/.test(id)) return null;
    return [ts, id];
  } catch {
    return null;
  }
}

/** `?after=` / `?before=` from the page's query string. `after` wins if both are present. */
export function parseCursor(params = {}) {
  for (const direction of CURSOR_PARAMS) {
    const values = decodeCursor(params?.[direction]);
    if (values) return { direction, values };
  }
  return null;
}

/**
 * The WHERE condition and ORDER BY for one keyset page.
 *
 * `before` reads the page preceding the cursor, which means scanning the other
 * way from the cursor and reversing the rows afterwards (`reverse: true`).
 *
 * @param {{direction: 'after'|'before', values: [string, string]}|null} cursor
 * @param {{ts: string, id: string, descending: boolean}} key  SQL expressions, from code — never user input
 * @param {number} firstPlaceholder  the $n the condition's first value takes
 */
export function keysetClause(cursor, { ts, id, descending }, firstPlaceholder) {
  const natural = descending ? 'DESC' : 'ASC';
  if (!cursor) return { condition: null, values: [], orderBy: `${ts} ${natural}, ${id} ${natural}`, reverse: false };
  const forward = cursor.direction === 'after';
  const comparator = descending === forward ? '<' : '>';
  const scan = (forward ? descending : !descending) ? 'DESC' : 'ASC';
  return {
    condition: `(${ts}, ${id}) ${comparator} ($${firstPlaceholder}, $${firstPlaceholder + 1})`,
    values: cursor.values,
    orderBy: `${ts} ${scan}, ${id} ${scan}`,
    reverse: !forward,
  };
}

/** Cursors for the rows a page is showing, read from each row's `cursor_ts` and `id`. */
export function pageCursors(rows) {
  if (!rows?.length) return { next: null, prev: null };
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    next: encodeCursor([last.cursor_ts, last.id]),
    prev: encodeCursor([first.cursor_ts, first.id]),
  };
}

/**
 * Which page numbers a pager shows: always the first and last, two either side
 * of the current page, and `null` for each gap — so 30,000 rows at 25 a page is
 * seven buttons, not twelve hundred.
 */
export function pageWindow(page, pages, span = 2) {
  const out = [];
  let previous = 0;
  for (let n = 1; n <= pages; n += 1) {
    if (n === 1 || n === pages || Math.abs(n - page) <= span) {
      if (n - previous > 1) out.push(null);
      out.push(n);
      previous = n;
    }
  }
  return out;
}

/** "YYYY-MM-DD" typed in an admin date filter, as the UTC instant Kinshasa midnight (UTC+1, no DST) is. */
export function kinshasaDayStart(day) {
  const text = String(firstParam(day) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00+01:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The instant the day AFTER `day` starts — an inclusive "to" date becomes an exclusive bound. */
export function kinshasaDayEnd(day) {
  const start = kinshasaDayStart(day);
  if (!start) return undefined;
  return new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
}
