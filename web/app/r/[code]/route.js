import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { normaliseReferralCode } from '@/lib/launchCommission';
import { findRepByReferralCode, recordReferralClick } from '@/lib/salesLaunch';
import {
  REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, clientIpFrom, hashReferralIp, parseReferralCookie, referralCookieValue,
} from '@/lib/salesReferral';

export const dynamic = 'force-dynamic';

/**
 * A sales rep's referral link (`/r/JEAN01`, `?src=qr` from the printed QR code).
 * Counts the click, remembers the referral for 30 days, and opens agent signup
 * with the code filled in. The first valid referral a browser carries wins:
 * a second rep's link does not replace it. An unknown or inactive code still
 * reaches signup, just without a code.
 */
export async function GET(request, { params }) {
  const { code: raw } = await params;
  const source = new URL(request.url).searchParams.get('src') === 'qr' ? 'qr' : 'link';
  const code = normaliseReferralCode(raw);
  let effective = null;

  try {
    const rep = code ? await findRepByReferralCode(code) : null;
    if (rep && rep.status === 'active') {
      const cookieStore = await cookies();
      const existing = parseReferralCookie(cookieStore.get(REFERRAL_COOKIE)?.value);
      let keepExisting = false;
      if (existing && existing.code !== rep.referral_code) {
        const existingRep = await findRepByReferralCode(existing.code);
        keepExisting = Boolean(existingRep && existingRep.status === 'active');
      }
      if (keepExisting) {
        effective = existing.code;
      } else {
        effective = rep.referral_code;
        if (!existing || existing.code !== rep.referral_code) {
          cookieStore.set(REFERRAL_COOKIE, referralCookieValue(rep.referral_code, source), {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: REFERRAL_COOKIE_MAX_AGE,
          });
        }
      }
      const headerList = await headers();
      await recordReferralClick({
        repId: rep.id,
        code: rep.referral_code,
        source,
        ipHash: hashReferralIp(clientIpFrom(headerList)),
        userAgent: headerList.get('user-agent'),
      });
    }
  } catch (err) {
    // A referral that cannot be recorded must never stop someone reaching signup.
    console.error(`[sales-referral] /r/${String(raw).slice(0, 20)} failed: ${err.message}`);
  }

  // Relative, like the impersonation exit: behind nginx request.url carries the upstream host.
  const destination = effective ? `/compte/agent/inscription?ref=${encodeURIComponent(effective)}` : '/compte/agent/inscription';
  return new NextResponse(null, { status: 303, headers: { Location: destination, 'Cache-Control': 'no-store' } });
}
