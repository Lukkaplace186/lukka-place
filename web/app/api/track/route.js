import { getPool } from '@/lib/db';
import { analyticsDimensions } from '@/lib/requestContext';
import { clientKey, rateLimited, usableAmount } from '@/lib/eventIngest';

/**
 * Public, write-only event logger for the /admin/dashboard analytics
 * (web/lib/analytics.js). No auth — same trust level as any client-side
 * beacon — and no read capability exposed here at all. Four event types,
 * matching the three tables this exists to feed; anything else is a 400, not
 * silently accepted junk.
 *
 * `listing_saved` / `listing_unsaved` are the newest pair and land in
 * `listing_events`, NOT in `whatsapp_clicks` or `page_views`. A save is a
 * different funnel step from an enquiry and mixing them would silently
 * inflate the conversion rate getWhatsAppConversionRate reports. They are
 * also the only events that carry an UNSAVE — the pair is stored as two
 * rows with an `event` discriminator rather than one row that gets deleted,
 * because "changed their mind" is itself a real signal and a delete would
 * erase it. See web/scripts/setup-listing-events.js for the schema.
 *
 * `price` is the listing's canonical USD figure at the moment of the event.
 * Recorded on the row rather than joined back from `properties` at read
 * time on purpose: a listing's price changes, and a saved-at-$1,100 event
 * must keep saying $1,100 after the agent drops it to $950.
 *
 * Device and traffic source are derived from request HEADERS, never from the
 * body — see lib/requestContext.js. The body stays the client's claim about
 * *what* it did; the headers are the browser's own account of *who* it is.
 *
 * Rate limited per IP. This endpoint is unauthenticated and writes straight
 * to production Postgres, so without a limit anyone could inflate the
 * numbers with a loop — and these figures are meant to be sold, which makes
 * "trivially skewable" a product problem, not just an ops one. The limiter is
 * in-process and best-effort: the app runs as a single PM2 fork (see
 * web/CLAUDE.md), so one process sees all traffic today. It is a speed bump
 * against casual abuse, not a defence against a determined distributed
 * attacker — that needs a real store, and is worth adding if the numbers ever
 * carry commercial weight on their own.
 *
 * The limiter, `usableAmount` and `clientKey` live in lib/eventIngest.js,
 * shared with /api/telemetry/lead-click so both endpoints draw on ONE per-IP
 * budget. `whatsapp_click` stays accepted here for pages cached before the
 * storefront CTAs moved to the routing-aware lead-click beacon.
 */

export async function POST(request) {
  if (rateLimited(clientKey(request))) {
    return Response.json({ success: false, error: 'Too many events' }, { status: 429 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { type, path, commune, listingId, price, utmSource } = body || {};
  const { device, source } = analyticsDimensions(request.headers, { utmSource });
  const pool = getPool();

  try {
    if (type === 'page_view') {
      if (!path) return Response.json({ success: false, error: 'path is required' }, { status: 400 });
      await pool.query(
        'INSERT INTO page_views (path, commune, device, source) VALUES ($1, $2, $3, $4)',
        [path, commune || null, device, source],
      );
    } else if (type === 'whatsapp_click') {
      await pool.query(
        'INSERT INTO whatsapp_clicks (listing_id, commune, device, source, price) VALUES ($1, $2, $3, $4, $5)',
        [listingId || null, commune || null, device, source, usableAmount(price)],
      );
    } else if (type === 'listing_saved' || type === 'listing_unsaved') {
      // A save with no listing is not a usable row — there is nothing to
      // attribute it to, and a NULL-listing row would quietly pad every
      // per-listing count with events belonging to no listing at all.
      if (!listingId) {
        return Response.json({ success: false, error: 'listingId is required' }, { status: 400 });
      }
      await pool.query(
        `INSERT INTO listing_events (event, listing_id, commune, price, device, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [type, listingId, commune || null, usableAmount(price), device, source],
      );
    } else {
      return Response.json(
        { success: false, error: "type must be 'page_view', 'whatsapp_click', 'listing_saved' or 'listing_unsaved'" },
        { status: 400 },
      );
    }
  } catch (err) {
    console.error(`[api/track] insert failed: ${err.message}`);
    return Response.json({ success: false }, { status: 500 });
  }

  return Response.json({ success: true });
}
