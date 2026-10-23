import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { POST_TEXT_MAX, cleanPostUrl, extractCongoPhones } from '@/lib/facebookLeadParser';
import { recordFacebookProspects } from '@/lib/facebookProspects';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ingest/facebook-lead — one Facebook group post or comment from
 * whatever automation reads the groups. Body:
 * { postText, authorName?, postUrl?, groupName? }.
 *
 * Bearer FACEBOOK_INGEST_SECRET, its own secret rather than CRON_SECRET: this
 * one is pasted into a third-party tool, and a leak there must not open the
 * cron and agent-command routes. Unset → every call is refused.
 *
 * Answers { ok, found, created, skipped } — numbers as +243XXXXXXXXX; skipped
 * carries why (ours / agent / already_prospect). A post with no number is a
 * 200 with found: 0, so the sender does not retry it.
 */

function isAuthorized(request) {
  const expected = process.env.FACEBOOK_INGEST_SECRET;
  if (!expected) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const postText = body?.postText;
  if (typeof postText !== 'string' || !postText.trim()) {
    return NextResponse.json({ error: 'postText required' }, { status: 400 });
  }
  if (postText.length > POST_TEXT_MAX) {
    return NextResponse.json({ error: 'postText too long' }, { status: 413 });
  }

  const phones = extractCongoPhones(postText);
  if (!phones.length) return NextResponse.json({ ok: true, found: 0, created: [], skipped: [] });

  try {
    const result = await recordFacebookProspects({
      phones,
      authorName: body.authorName,
      groupName: body.groupName,
      postUrl: cleanPostUrl(body.postUrl),
      postText,
    });
    return NextResponse.json({ ok: true, found: phones.length, ...result });
  } catch (err) {
    if (err?.code === '42P01') {
      console.error('[facebook-lead] facebook_prospects is missing — run migrations/20261023_facebook_prospects.sql');
      return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
    }
    console.error(`[facebook-lead] ${err.message}`);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
