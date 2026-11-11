import 'server-only';
import { cookies, headers } from 'next/headers';
import { APP_MODE_COOKIE, isAppMode } from './appModeRules';

/** True when this request comes from the Lukka Place app (lib/appModeRules.js). */
export async function isAppRequest() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return isAppMode({
    cookieValue: cookieStore.get(APP_MODE_COOKIE)?.value,
    userAgent: headerList.get('user-agent'),
  });
}
