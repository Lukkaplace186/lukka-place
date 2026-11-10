import { chatJson } from '@/lib/chatApi';
import { countUnreadNotifications } from '@/lib/pushNotifications';
import { currentPushAccount } from '@/lib/pushSession';
import { parseSide } from '@/lib/pushRules';

export const dynamic = 'force-dynamic';

/** GET /api/push/unread?as=agent|customer — `{unread: n}` for the inbox badge (lib/useAlertsUnread.js). */
export async function GET(request) {
  const account = await currentPushAccount(parseSide(new URL(request.url).searchParams.get('as')));
  if (!account) return chatJson({ error: 'unauthorized' }, 401);
  return chatJson({ unread: await countUnreadNotifications(account.userType, account.userId) });
}
