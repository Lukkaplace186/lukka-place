import { after } from 'next/server';
import { clientKey, rateLimited } from '@/lib/eventIngest';
import { cleanAdEvent } from '@/lib/adTrackingRules';
import { adUserFromRequest } from '@/lib/adServerContext';
import { sendAdServerEvent } from '@/lib/adServerEvents';

/**
 * POST /api/ad-event — the server copy of a browser ad event
 * (lib/adEvents.js): same event id, sent to Meta and TikTok after the
 * response (lib/adServerEvents.js). Write-only, rate limited with the other
 * beacons, and a no-op without consent (`lp_consent`) or without the
 * platforms' server tokens. Always 204: what happened next is the server's
 * business, not the visitor's.
 */
export async function POST(request) {
  if (rateLimited(clientKey(request))) return new Response(null, { status: 429 });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const event = cleanAdEvent(body);
  if (!event) return new Response(null, { status: 400 });
  const user = await adUserFromRequest();
  if (user) after(() => sendAdServerEvent({ ...event, user }));
  return new Response(null, { status: 204 });
}
