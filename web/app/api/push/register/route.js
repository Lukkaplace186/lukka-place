import { chatJson, readChatJson } from '@/lib/chatApi';
import { registerDevice } from '@/lib/pushNotifications';
import { currentPushAccount } from '@/lib/pushSession';
import { PUSH_TOKEN_COOKIE, parseRegistration, parseSide } from '@/lib/pushRules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/push/register — the Lukka Place app hands over this phone's
 * Firebase token after the person allowed notifications
 * (`{token, platform: 'android'|'ios', appVersion?, as: 'agent'|'customer'}`).
 * The account is that side's own session (lib/pushSession.js), never a
 * request value.
 *
 * The token is also kept in an httpOnly cookie so logout can revoke this
 * phone without the page having to run first. 503 before the migration: the
 * app then keeps getting WhatsApp, as before.
 */
export async function POST(request) {
  const body = await readChatJson(request);
  const account = await currentPushAccount(parseSide(body?.as));
  if (!account) return chatJson({ error: 'unauthorized' }, 401);
  const registration = parseRegistration(body);
  if (!registration) return chatJson({ error: 'invalid' }, 400);

  const result = await registerDevice(account.userType, account.userId, registration);
  if (result !== 'ok') return chatJson({ error: 'unavailable' }, 503);

  const response = chatJson({ ok: true });
  response.cookies.set(PUSH_TOKEN_COOKIE, registration.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
