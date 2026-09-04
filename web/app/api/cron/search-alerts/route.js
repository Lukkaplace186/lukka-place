import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getListings } from '@/lib/listings';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import { getSavedSearchesWithPhone, getNotifiedPropertyIds, recordNotifiedProperties } from '@/lib/searchAlerts';
import { sendWhatsAppTemplate } from '@/lib/adminApi';
import { formatPrice } from '@/lib/format';

/**
 * Proactive WhatsApp alert sweep — re-runs every real saved search through
 * the same getListings()/parseListingsSearchParams() the /listings page and
 * the pull-model Alertes tab already use (no second, divergent copy of the
 * filter logic), and texts the owner when a genuinely new match appears.
 *
 * Not self-scheduling: this route has no cron of its own (a Next.js app has
 * no persistent background process to host one in), so it's a plain
 * secret-protected endpoint meant to be called periodically by something
 * outside this app — a VPS crontab entry, or an external scheduled-ping
 * service. See the deploy notes for the exact command; this file only does
 * the work once invoked.
 *
 * Also requires a real Meta-approved WhatsApp template
 * (SEARCH_ALERT_TEMPLATE) before any message can actually be delivered —
 * same external, non-code dependency the existing OTP flow already has
 * (see lib/agents.js's sendAgentOtp).
 */
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const template = process.env.SEARCH_ALERT_TEMPLATE || 'search_alert';
  const languageCode = process.env.SEARCH_ALERT_TEMPLATE_LANG || 'fr';

  // Absolute, because this goes into a WhatsApp message — there is no page
  // for a relative URL to be relative to. Falls back to the production
  // origin rather than localhost: a link to localhost in a customer's
  // WhatsApp is worse than no alert at all.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

  const searches = await getSavedSearchesWithPhone();
  let notifiedSearches = 0;
  let notifiedListings = 0;
  const errors = [];

  for (const search of searches) {
    try {
      const filters = parseListingsSearchParams(new URLSearchParams(search.query));
      const { data } = await getListings({ ...filters, sort: 'newest', limit: 10 });

      const savedAt = new Date(search.created_at).getTime();
      const alreadyNotified = await getNotifiedPropertyIds(search.id);
      const freshMatches = data.filter(
        (listing) => new Date(listing.created_at).getTime() > savedAt && !alreadyNotified.has(Number(listing.id)),
      );
      if (!freshMatches.length) continue;

      const top = freshMatches[0];

      // The link is the point of the whole alert: "nous avons trouvé 3 biens"
      // has to open exactly those three. `ids` (lib/searchQuery.js) is what
      // makes the page agree with the number in the message — re-running the
      // saved search instead would show everything that has ever matched it,
      // so a visitor told "3" could land on a page of 40.
      //
      // The saved search's own query string rides along so the filter bar
      // opens in the state the customer saved, and clearing the id chip
      // leaves them in a working search rather than an empty page.
      const params = new URLSearchParams(search.query);
      params.set('ids', freshMatches.map((l) => l.id).join(','));
      const link = `${siteUrl}/listings?${params.toString()}`;

      await sendWhatsAppTemplate(search.phone, {
        template,
        languageCode,
        bodyParams: [
          search.label,
          String(freshMatches.length),
          `${top.title} — ${formatPrice(top.price, top.purpose, top.price_period)}`,
          link,
        ],
      });

      await recordNotifiedProperties(search.id, freshMatches.map((l) => Number(l.id)));
      notifiedSearches += 1;
      notifiedListings += freshMatches.length;
    } catch (err) {
      // Best-effort across searches — one bad query string or one failed
      // WhatsApp send must not stop the rest of the sweep, and a failure
      // here deliberately does NOT record anything as notified, so it's
      // retried on the next run rather than silently dropped.
      console.error(`[search-alerts] saved search #${search.id} failed: ${err.message}`);
      errors.push({ savedSearchId: search.id, error: err.message });
    }
  }

  return NextResponse.json({ checked: searches.length, notifiedSearches, notifiedListings, errors });
}
