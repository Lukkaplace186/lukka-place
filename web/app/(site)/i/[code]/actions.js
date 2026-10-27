'use server';

import { cookies, headers } from 'next/headers';
import { normalisePartnerCode } from '@/lib/partnerRules';
import { findActivePartnerByCode } from '@/lib/partners';
import { rememberPartnerVisit } from '@/lib/partnerVisit';

/**
 * Called once by the invite page in the browser: remembers the partner and
 * counts the visit, exactly as /go does (lib/partnerVisit.js). From the
 * browser rather than at render, because a Server Component cannot set
 * cookies, and so that the card WhatsApp's link-preview fetcher draws (no
 * JavaScript) is never counted as a person.
 *
 * @returns {Promise<{ok: boolean}>}
 */
export async function rememberInviteAction(rawCode) {
  const code = normalisePartnerCode(rawCode);
  if (!code) return { ok: false };
  try {
    const partner = await findActivePartnerByCode(code);
    if (!partner) return { ok: false };
    await rememberPartnerVisit({
      partner,
      via: 'link',
      landingPath: `/i/${code}`,
      cookieStore: await cookies(),
      headerList: await headers(),
    });
    return { ok: true };
  } catch (err) {
    console.error(`[invite] ${code} not remembered: ${err.message}`);
    return { ok: false };
  }
}
