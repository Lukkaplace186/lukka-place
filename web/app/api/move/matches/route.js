import { clientKey, rateLimited } from '@/lib/eventIngest';
import { parseMoveProject } from '@/lib/moveProjectRules';
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

export async function POST(request) {
  if (rateLimited(`move-matches:${clientKey(request)}`)) {
    return Response.json({ error: 'rate' }, { status: 429 });
  }
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ error: 'body' }, { status: 400 });
  }
  const { project } = parseMoveProject(body);
  try {
    const result = await getMoveMatches(project, { exactLimit: PREVIEW_EXACT, closeLimit: PREVIEW_CLOSE });
    if (!result) return Response.json({ total: 0, exact: [], close: [], query: null });
    return Response.json(
      {
        total: result.total,
        query: result.query,
        exact: result.exact.map((l) => previewCard(l)),
        close: result.close.map(({ listing, tags }) => previewCard(listing, tags)),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error(`[move-matches] preview failed: ${err.message}`);
    return Response.json({ error: 'server' }, { status: 500 });
  }
}
