import { SHARED_IP_MAX_EVENTS, clientKey, rateLimited } from '@/lib/eventIngest';
import { moveSearchQuery, parseMoveProject } from '@/lib/moveProjectRules';
import { getMoveMatches, previewCard } from '@/lib/moveMatches';

/**
 * The budget card's live preview ("Mon déménagement", components/MoveOnboarding.js):
 * as the customer moves the range, how many homes match and the first few —
 * or, when few do, the closest ones with why they are close (lib/moveMatches.js).
 *
 * Public on purpose: the flow runs before the account exists, and this only
 * reads approved public listings (the same as /listings). Everything posted is
 * re-validated by parseMoveProject; nothing is stored.
 *
 * POST, not GET, because the answers are a small JSON object, not a URL.
 */

const PREVIEW_EXACT = 3;
const PREVIEW_CLOSE = 3;

/**
 * Identical searches answered from memory for a minute (2026-11-07, before
 * the campaign): each preview costs 2–4 queries, one a city-wide marker
 * scan, and a rush means many customers picking the same commune and preset.
 * Keyed by the project's /listings query, which carries every field the
 * matching reads. Public approved listings only, the same for everyone, so
 * sharing an answer between customers reveals nothing. A minute-old count is
 * an acceptable preview; the project page reads live.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;
const cache = new Map();

function cached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function remember(key, payload) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), payload });
}

export async function POST(request) {
  if (rateLimited(`move-matches:${clientKey(request)}`, SHARED_IP_MAX_EVENTS)) {
    return Response.json({ error: 'rate' }, { status: 429 });
  }
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: 'body' }, { status: 400 });
  }
  const { project } = parseMoveProject(body);
  const key = moveSearchQuery(project);
  if (!key) return Response.json({ total: 0, exact: [], close: [], query: null });
  const headers = { 'Cache-Control': 'private, no-store' };
  const hit = cached(key);
  if (hit) return Response.json(hit, { headers });
  try {
    const result = await getMoveMatches(project, { exactLimit: PREVIEW_EXACT, closeLimit: PREVIEW_CLOSE });
    const payload = result
      ? {
        total: result.total,
        query: result.query,
        exact: result.exact.map((l) => previewCard(l)),
        close: result.close.map(({ listing, tags }) => previewCard(listing, tags)),
      }
      : { total: 0, exact: [], close: [], query: null };
    remember(key, payload);
    return Response.json(payload, { headers });
  } catch (err) {
    console.error(`[move-matches] preview failed: ${err.message}`);
    return Response.json({ error: 'server' }, { status: 500 });
  }
}
