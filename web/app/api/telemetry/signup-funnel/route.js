import { analyticsDimensions } from '@/lib/requestContext';
import { clientKey, rateLimited } from '@/lib/eventIngest';
import { attributionFromBody, eventSource, viewerKindFor, visitorIdFrom, signedInAgentIdFrom } from '@/lib/trackIngest';

/**
 * How far a visitor got on a signup form, as one log line per step:
 *   [signup-funnel] {"form":"agent","step":"form_start","source":"fb",...}
 *
 * Built after the 29–30 October 2026 agent campaign: 4,215 visitors landed on
 * /compte/agent/inscription, 2 reached the code step, and nothing recorded
 * whether the other 4,213 left without looking or gave up halfway. The page
 * view already says who arrived; these say who touched the form, who pressed
 * the button and who left for WhatsApp instead.
 *
 * A log line rather than a table, like /api/telemetry/vitals: no migration,
 * running today. Read on the VPS with
 *   pm2 logs lukka-place-web --lines 20000 --nostream | grep '\[signup-funnel\]'
 * Count people with the `visitor` field, not lines. `viewer` lets a reader
 * drop the team and bots, which are logged like everyone else.
 *
 * Public endpoint: every field is an allow-listed value or a bounded tag, so
 * a log line is never free text somebody chose.
 */

export const SIGNUP_FORMS = new Set(['agent']);
export const SIGNUP_STEPS = new Set(['form_start', 'submit', 'whatsapp_tap', 'referral_open']);
const TAG_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function sanitizeSignupStep(body, { source, campaign, device, viewer, visitor }) {
  if (!body || !SIGNUP_FORMS.has(body.form) || !SIGNUP_STEPS.has(body.step)) return null;
  return {
    form: body.form,
    step: body.step,
    source: TAG_RE.test(source || '') ? source : 'direct',
    campaign: TAG_RE.test(campaign || '') ? campaign : null,
    device: TAG_RE.test(device || '') ? device : null,
    viewer,
    visitor: visitor || null,
  };
}

export async function POST(request) {
  if (rateLimited(`signup-funnel:${clientKey(request)}`)) {
    return new Response(null, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const attribution = attributionFromBody(body);
  const { device, source: headerSource } = analyticsDimensions(request.headers, {});
  const line = sanitizeSignupStep(body, {
    source: eventSource(attribution, headerSource),
    campaign: attribution?.campaign ?? null,
    device,
    viewer: viewerKindFor(request, device, { automated: body?.automated === true, agentId: signedInAgentIdFrom(request) }),
    visitor: visitorIdFrom(request, body?.visitorId),
  });
  if (line) console.log(`[signup-funnel] ${JSON.stringify(line)}`);

  return new Response(null, { status: 204 });
}
