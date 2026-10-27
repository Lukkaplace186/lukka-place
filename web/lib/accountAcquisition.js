import 'server-only';
import { cookies, headers } from 'next/headers';
import { getPool } from './db';
import { VISITOR_COOKIE, cleanVisitorId } from './trackIngest';
import { PARTNER_COOKIE, normalisePartnerCode, parsePartnerCookie } from './partnerRules';
import { findActivePartnerByCode, recordPartnerConversion } from './partners';
import { clientIpFrom, hashReferralIp } from './salesReferral';

/**
 * Where each account came from, written ONCE when it is created
 * (`account_acquisitions`, migrations/20261027_growth_attribution.sql).
 *
 * The visitor's first and last touch are copied from `visitor_touches` in the
 * same INSERT — a copy, not a join kept for later, because the browser that
 * signed up can clear its cookie or touch something else tomorrow and the
 * account's origin must not move with it. A visitor with no touch row (no
 * beacon reached us: tracking blocked, a first page that was the signup form
 * itself) still gets a row, with the channel and referral code and nothing
 * invented for the rest.
 *
 * Nothing here can cost anybody their account: every failure is logged and
 * swallowed, and a missing table (before the migration) records nothing.
 */

const MISSING_TABLE = '42P01';

export const RECORD_ACCOUNT_ACQUISITION_SQL = `
  INSERT INTO account_acquisitions (
    account_type, account_id, channel, visitor_id,
    first_source, first_medium, first_campaign, first_content, first_click_id_type,
    first_referrer_host, first_landing_path, first_seen_at,
    last_source, last_medium, last_campaign, last_content, last_click_id_type,
    last_referrer_host, last_landing_path, last_touch_at,
    ref_code, partner_id
  )
  SELECT $1, $2, $3, $4::text,
         t.first_source, t.first_medium, t.first_campaign, t.first_content, t.first_click_id_type,
         t.first_referrer_host, t.first_landing_path, t.first_seen_at,
         t.last_source, t.last_medium, t.last_campaign, t.last_content, t.last_click_id_type,
         t.last_referrer_host, t.last_landing_path, t.last_touch_at,
         $5::text, $6::bigint
  FROM (SELECT 1) AS one
  LEFT JOIN visitor_touches t ON t.visitor_id = $4::text
  ON CONFLICT (account_type, account_id) DO NOTHING
`;

/** @returns {Promise<boolean>} whether a row was written */
export async function recordAccountAcquisition({
  accountType, accountId, channel = 'web', visitorId = null, refCode = null, partnerId = null,
}) {
  try {
    const { rowCount } = await getPool().query(RECORD_ACCOUNT_ACQUISITION_SQL, [
      accountType,
      accountId,
      channel,
      cleanVisitorId(visitorId),
      refCode || null,
      partnerId || null,
    ]);
    return rowCount > 0;
  } catch (err) {
    if (err?.code !== MISSING_TABLE) {
      console.error(`[acquisition] ${accountType} #${accountId} not recorded: ${err.message}`);
    }
    return false;
  }
}

/**
 * Called by the web signup actions right after the row exists: credits the
 * partner whose link this browser followed (`lp_ref`, first valid one wins)
 * and records where the account came from.
 *
 * @param {{accountType: 'customer'|'agent', accountId: number, phone: string|null,
 *          repCode?: string|null, typedCode?: string|null}} account
 *   `repCode` — a sales rep's code the agent signup attributed, kept as the
 *   account's referral code when no partner code is carried.
 *   `typedCode` — a partner code typed in the signup form (already checked by
 *   the action): it is what the person chose, so it wins over the cookie.
 */
export async function recordWebSignupAttribution({ accountType, accountId, phone = null, repCode = null, typedCode = null }) {
  try {
    const cookieStore = await cookies();
    const headerList = await headers();
    const visitorId = cleanVisitorId(cookieStore.get(VISITOR_COOKIE)?.value);
    const carried = parsePartnerCookie(cookieStore.get(PARTNER_COOKIE)?.value);
    // An account opened by the team, or while viewing the site as someone
    // else, never credits a partner (lib/referralRules.js "never earns").
    const teamBrowser = cookieStore.get('lp_staff')?.value === '1' || Boolean(cookieStore.get('lukka_impersonation')?.value);

    let partner = null;
    let via = carried?.via ?? null;
    const wanted = normalisePartnerCode(typedCode) || carried?.code || null;
    if (wanted) {
      try {
        partner = await findActivePartnerByCode(wanted);
      } catch (err) {
        console.error(`[acquisition] partner lookup failed: ${err.message}`);
      }
      if (partner && carried?.code !== partner.code) via = 'form_code';
    }

    let creditedPartnerId = null;
    if (partner && teamBrowser) {
      console.log(`[acquisition] ${accountType} #${accountId}: created from a team browser, ${partner.code} not credited`);
    } else if (partner) {
      const result = await recordPartnerConversion({
        partner,
        accountType,
        accountId,
        accountPhone: phone,
        via,
        visitorId,
        ipHash: hashReferralIp(clientIpFrom(headerList)),
      });
      if (result.recorded) creditedPartnerId = partner.id;
      else if (result.reason === 'self_referral') console.log(`[acquisition] ${accountType} #${accountId}: own code ${partner.code} not credited`);
    }

    await recordAccountAcquisition({
      accountType,
      accountId,
      channel: 'web',
      visitorId,
      refCode: creditedPartnerId ? partner.code : repCode || null,
      partnerId: creditedPartnerId,
    });
  } catch (err) {
    console.error(`[acquisition] ${accountType} #${accountId}: ${err.message}`);
  }
}
