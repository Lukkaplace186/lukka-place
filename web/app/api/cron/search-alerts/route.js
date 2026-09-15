import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getListings, getRecentListingIds } from '@/lib/listings';
import {
  getSavedSearchesDueForAlerts,
  getNotifiedPropertyIds,
  recordNotifiedProperties,
  markSavedSearchAlerted,
} from '@/lib/searchAlerts';
import { sendWhatsAppTemplate, sendWhatsAppMessage } from '@/lib/adminApi';
import { runAlertSweepChunk } from '@/lib/searchAlertSweep';

/**
 * Proactive WhatsApp alert sweep, ONE CHUNK per call — see
 * lib/searchAlertSweep.js for what a chunk does and why it is chunked.
 *
 * Called by the engine's scheduler (services/scheduler.js, job
 * `search-alerts`, daily), which posts `{cursor}` and calls again with the
 * returned cursor until `done`. Secret-protected; nothing else should call it.
 *
 * TEMPLATE FIRST, ONLY WHEN ONE IS CONFIGURED. `SEARCH_ALERT_TEMPLATE` used to
 * default to 'search_alert', a name nobody has shown Meta approved — the same
 * default the engine removed from its own templates because every send paid a
 * guaranteed-failing round trip. Unset now means a plain session message,
 * which reaches a customer who messaged us in the last 24 hours and silently
 * nobody else (root CLAUDE.md, "Outbound WhatsApp"). A configured template
 * that fails falls back to that same message.
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

  const body = await request.json().catch(() => ({}));
  const parsedCursor = Number.parseInt(body?.cursor, 10);
  const template = process.env.SEARCH_ALERT_TEMPLATE || null;
  const languageCode = process.env.SEARCH_ALERT_TEMPLATE_LANG || 'fr';

  async function send(phone, { bodyParams, text }) {
    if (template) {
      try {
        await sendWhatsAppTemplate(phone, { template, languageCode, bodyParams });
        return;
      } catch (err) {
        console.warn(`[search-alerts] template '${template}' failed for ${phone}, sending a session message: ${err.message}`);
      }
    }
    await sendWhatsAppMessage(phone, text);
  }

  const result = await runAlertSweepChunk({
    cursor: Number.isFinite(parsedCursor) ? parsedCursor : 0,
    // Absolute, because this goes into a WhatsApp message. Falls back to the
    // production origin rather than localhost: a localhost link in a
    // customer's WhatsApp is worse than no alert at all.
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com',
    deps: {
      getRecentListings: getRecentListingIds,
      getDueSearches: getSavedSearchesDueForAlerts,
      getListings,
      getNotified: getNotifiedPropertyIds,
      send,
      recordNotified: recordNotifiedProperties,
      markAlerted: markSavedSearchAlerted,
    },
  });

  for (const { savedSearchId, error } of result.errors) {
    console.error(`[search-alerts] saved search #${savedSearchId} failed: ${error}`);
  }
  for (const warning of result.warnings) console.warn(`[search-alerts] ${warning}`);

  return NextResponse.json(result);
}
