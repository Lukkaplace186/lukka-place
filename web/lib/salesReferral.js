import { createHmac } from 'node:crypto';
import { normaliseReferralCode } from './launchCommission';

/**
 * Referral links, the cookie that carries a referral to the signup form, and
 * the messages a rep shares. Server-side only (node:crypto), no database —
 * lib/salesLaunch.js does the reads and writes.
 *
 * FIRST VALID REFERRAL WINS. /r/<code> sets `lukka_ref` only when the browser
 * does not already carry a valid one, so a second rep's link opened later does
 * not take the agent over. The cookie is not signed: tampering with it can only
 * choose a different real code, which the signup form lets anyone type anyway.
 */

export const REFERRAL_COOKIE = 'lukka_ref';
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
export const REFERRAL_SOURCES = ['link', 'qr'];

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

/** `JEAN01.qr` → { code: 'JEAN01', source: 'qr' }; anything else → null. */
export function parseReferralCookie(value) {
  const [code, source] = String(value ?? '').split('.');
  const clean = normaliseReferralCode(code);
  return clean ? { code: clean, source: source === 'qr' ? 'qr' : 'link' } : null;
}

export function referralCookieValue(code, source) {
  return `${code}.${source === 'qr' ? 'qr' : 'link'}`;
}

/** The connection, hashed with the session secret: comparable, never reversible to an address. */
export function hashReferralIp(ip, secret = process.env.ADMIN_SESSION_SECRET) {
  const value = String(ip ?? '').trim();
  if (!value || !secret) return null;
  return createHmac('sha256', secret).update(`sales-referral-ip:${value}`).digest('hex').slice(0, 32);
}

/** First address of X-Forwarded-For, else X-Real-IP — same reading as lib/adminAudit.js. */
export function clientIpFrom(headers) {
  const forwarded = headers?.get?.('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : headers?.get?.('x-real-ip') || '').trim() || null;
}

export function referralLink(code, { qr = false, siteUrl = SITE_URL } = {}) {
  return `${siteUrl}/r/${encodeURIComponent(code)}${qr ? '?src=qr' : ''}`;
}

/** What a rep sends an agent on WhatsApp: the web signup link. French — read by agents in Kinshasa. */
export function referralShareMessage(code, { siteUrl = SITE_URL } = {}) {
  return [
    'Bonjour ! Publiez vos biens gratuitement sur Lukka Place et recevez les demandes de clients sur WhatsApp.',
    `Inscrivez-vous ici : ${referralLink(code, { siteUrl })}`,
    `Code parrainage : ${code}`,
  ].join('\n');
}

/**
 * The pre-typed first message for an agent who would rather register on
 * WhatsApp. The engine recognises "Code parrainage : JEAN01" in it
 * (services/salesReferral.js) and attributes the account it creates.
 */
export function whatsappOnboardingText(code) {
  return `Bonjour Lukka Place, je suis agent immobilier et je souhaite publier mes biens. Code parrainage : ${code}`;
}

export function whatsappOnboardingLink(code, businessNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER) {
  const digits = String(businessNumber ?? '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(whatsappOnboardingText(code))}` : null;
}

export function whatsappShareLink(code) {
  return `https://wa.me/?text=${encodeURIComponent(referralShareMessage(code))}`;
}
