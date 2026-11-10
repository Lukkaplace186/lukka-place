import { cookies } from 'next/headers';
import { chatJson, readChatJson } from '@/lib/chatApi';
import { revokeDevice } from '@/lib/pushNotifications';
import { currentPushAccount } from '@/lib/pushSession';
import { PUSH_TOKEN_COOKIE, TOKEN_MIN, parseSide } from '@/lib/pushRules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/push/unregister — stop alerts to this phone (alerts turned off
 * in the app), `{as, token?}`. The token is the body's or, failing that, the
 * cookie /api/push/register set. Only that account's row is revoked.
 */
export async function POST(request) {
  const body = (await readChatJson(request)) || {};
  const account = await currentPushAccount(parseSide(body.as));
  if (!account) return chatJson({ error: 'unauthorized' }, 401);
  const store = await cookies();
  const token = typeof body.token === 'string' && body.token.trim().length >= TOKEN_MIN
    ? body.token.trim()
    : store.get(PUSH_TOKEN_COOKIE)?.value;
  if (!token) return chatJson({ ok: true, revoked: false });

  const revoked = await revokeDevice(account.userType, account.userId, token, 'turned off in the app');
  const response = chatJson({ ok: true, revoked });
  response.cookies.set(PUSH_TOKEN_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
