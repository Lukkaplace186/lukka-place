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
