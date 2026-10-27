import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { resolveCode } from '@/lib/partners';
import { rememberPartnerVisit } from '@/lib/partnerVisit';
import { destinationForRest, normalisePartnerCode, safeDestination, taggedDestination } from '@/lib/partnerRules';

export const dynamic = 'force-dynamic';

/**
 * A partner's tracked link (lib/partnerRules.js): `/go/NADIA01` → the
 * homepage, `/go/NADIA01/387` → listing 387, and `?ref=NADIA01` on any page,
 * which middleware.js sends here with `?via=param&to=<that page>`.
 *
 * Counts the click (one per connection per partner per hour), remembers the
 * partner for 30 days unless the browser already carries a valid one (first
 * valid referral wins), and lands on the destination tagged with the
 * partner's campaign (utm_source agent / influencer / campagne, utm_content
 * the code) — unless it already says where it came from, as an agent's
 * shared link does.
 *
 * The visitor id (`lp_vid`) is minted here when the browser has none, so the
 * click and the visit that follows carry the same id; the browser beacon
 * (lib/analyticsClient.js) adopts the cookie it finds.
 *
 * A sales rep's code keeps its own path: `/go/<rep code>` hands over to
 * `/r/<rep code>` (agent signup, rep ledger). As `?ref=` on a page it is
 * ignored rather than pulling a customer off the page into agent signup.
 * An unknown or inactive code still lands, just untagged. Nothing here can
 * stop someone reaching the page they asked for.
 */
export async function GET(request, { params }) {
  const { code: raw, rest } = await params;
  const url = new URL(request.url);
  const via = url.searchParams.get('via') === 'param' ? 'param' : url.searchParams.get('src') === 'qr' ? 'qr' : 'link';
  let destination = safeDestination(url.searchParams.get('to')) || destinationForRest(rest);
  const code = normalisePartnerCode(raw);

  const response = (location) => new NextResponse(null, {
    status: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });

  try {
    const resolved = code ? await resolveCode(code) : null;

    if (resolved?.type === 'rep') {
      if (via === 'param') return response(destination);
      return response(`/r/${encodeURIComponent(resolved.code)}${via === 'qr' ? '?src=qr' : ''}`);
    }

    if (resolved?.type === 'partner') {
      const { partner } = resolved;
      await rememberPartnerVisit({
        partner,
        via,
        landingPath: destination.split('?')[0],
        cookieStore: await cookies(),
        headerList: await headers(),
      });
      destination = taggedDestination(destination, partner);
    }
  } catch (err) {
    // A link that cannot be recorded must never stop someone reaching the page.
    console.error(`[partners] /go/${String(raw).slice(0, 20)} failed: ${err.message}`);
  }

  // Relative, like /r: behind the proxy request.url carries the upstream host.
  return response(destination);
}
