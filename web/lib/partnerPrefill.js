import 'server-only';
import { cookies } from 'next/headers';
import { PARTNER_COOKIE, normalisePartnerCode, parsePartnerCookie } from './partnerRules';
import { findActivePartnerByCode } from './partners';

/**
 * The partner code a signup form opens with: the one this browser carries
 * (`lp_ref`, first valid referral wins) while that partner is still active,
 * else a well-formed code from the URL (the value sent back after a refused
 * submit). A code that would only be refused on submit is not offered.
 *
 * @returns {Promise<string>}
 */
export async function partnerCodePrefill(param = null) {
  try {
    const carried = parsePartnerCookie((await cookies()).get(PARTNER_COOKIE)?.value);
    if (carried && (await findActivePartnerByCode(carried.code))) return carried.code;
  } catch (err) {
    console.error(`[signup] partner prefill failed: ${err.message}`);
  }
  return normalisePartnerCode(param) || '';
}
