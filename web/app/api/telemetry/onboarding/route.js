import { clientKey, rateLimited } from '@/lib/eventIngest';
import { MOVE_STEPS } from '@/lib/moveProjectRules';

/**
 * "Mon déménagement" drop-off: components/MoveOnboarding.js beacons each card
 * reached, and this writes one log line per card —
 *   [onboarding] {"mode":"signup","step":"budget","index":8,"total":11}
 * A log line, like /api/telemetry/vitals: the owner cut signup to three
 * fields on 2026-11-06 because steps lost customers, so the cards must be
 * measured from day one, and that needs no table. Read on the VPS with
 *   pm2 logs lukka-place-web --lines 20000 --nostream | grep '\[onboarding\]'
 * Count lines per step: a card with far fewer arrivals than the one before
 * it is the card losing people.
 *
 * Public endpoint: everything is validated, nothing free-text is logged.
 */

const STEPS = new Set([...MOVE_STEPS, 'end']);
const MODES = new Set(['signup', 'edit']);

export function sanitizeOnboardingEvent(body) {
  if (!body || !MODES.has(body.mode) || !STEPS.has(body.step)) return null;
  const index = Number(body.index);
  const total = Number(body.total);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < 1 || total > 20 || index > total) return null;
  return { mode: body.mode, step: body.step, index, total };
}

export async function POST(request) {
  if (rateLimited(`onboarding:${clientKey(request)}`)) {
    return new Response(null, { status: 429 });
  }
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 400 });
  }
  const clean = sanitizeOnboardingEvent(body);
  if (clean) console.log(`[onboarding] ${JSON.stringify(clean)}`);
  return new Response(null, { status: 204 });
}
