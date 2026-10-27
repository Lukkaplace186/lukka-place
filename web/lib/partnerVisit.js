import 'server-only';
import { randomUUID } from 'node:crypto';
import { findActivePartnerByCode, recordPartnerClick } from './partners';
import { PARTNER_COOKIE, PARTNER_COOKIE_MAX_AGE, parsePartnerCookie, partnerCookieValue } from './partnerRules';
import { VISITOR_COOKIE, cleanVisitorId } from './trackIngest';
import { clientIpFrom, hashReferralIp } from './salesReferral';

const VISITOR_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * A visit through a partner's link: remembers the partner for 30 days unless
 * the browser already carries another ACTIVE one (first valid referral wins),
 * mints the visitor id when the browser has none (so the click and the visit
 * share it — the browser beacon adopts the cookie it finds), and counts the
 * click. Used by /go/<code> and by the invite page /i/<code>, from a context
 * that may set cookies (a route handler or a server action).
 *
 * @param {{partner: object, via: 'link'|'qr'|'param', landingPath: string,
 *          cookieStore: object, headerList: Headers}} visit
 */
export async function rememberPartnerVisit({ partner, via, landingPath, cookieStore, headerList }) {
  const secure = process.env.NODE_ENV === 'production';

  let visitorId = cleanVisitorId(cookieStore.get(VISITOR_COOKIE)?.value);
  if (!visitorId) {
    visitorId = randomUUID();
    cookieStore.set(VISITOR_COOKIE, visitorId, { path: '/', maxAge: VISITOR_MAX_AGE, sameSite: 'lax', secure, httpOnly: false });
  }

  const carried = parsePartnerCookie(cookieStore.get(PARTNER_COOKIE)?.value);
  let keepCarried = false;
  if (carried && carried.code !== partner.code) {
    keepCarried = Boolean(await findActivePartnerByCode(carried.code));
  }
  if (!keepCarried && (!carried || carried.code !== partner.code)) {
    cookieStore.set(PARTNER_COOKIE, partnerCookieValue(partner.code, via), {
      path: '/', maxAge: PARTNER_COOKIE_MAX_AGE, sameSite: 'lax', secure, httpOnly: true,
    });
  }

  await recordPartnerClick({
    partnerId: partner.id,
    via,
    visitorId,
    landingPath,
    ipHash: hashReferralIp(clientIpFrom(headerList)),
    userAgent: headerList.get('user-agent'),
  });
  return { visitorId, kept: keepCarried ? carried.code : partner.code };
}
