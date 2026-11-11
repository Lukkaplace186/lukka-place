import { NextResponse } from 'next/server';
import { getCurrentChatAgentId } from '@/lib/chat';
import { APP_MODE_COOKIE, APP_MODE_MAX_AGE } from '@/lib/appModeRules';

export const dynamic = 'force-dynamic';

/**
 * GET /app — where the Lukka Place app starts (mobile/capacitor.config.json
 * `server.url`). One app for everyone (owner decision 2026-11-10): an agent
 * still signed in lands in their agent space, everyone else on the listings
 * (a signed-in customer reaches the Espace Client from the header as on the
 * site). A relative Location: behind the proxy request.url names
 * localhost:3002 (see admin/impersonation/exit).
 *
 * It also switches on app mode (lib/appModeRules.js): the `lp_app` cookie,
 * which makes the site draw the app's tab bar. `?web=1` switches it off
 * again, for a browser that opened /app to preview the app.
 */
export async function GET(request) {
  const leaving = new URL(request.url).searchParams.get('web') === '1';
  let target = '/';
  if (!leaving) {
    try {
      if (await getCurrentChatAgentId()) target = '/compte/agent';
    } catch (err) {
      // The database briefly unreachable: open the listings rather than fail the app's launch.
      console.error(`[app] start: agent session check failed: ${err.message}`);
    }
  }
  const response = new NextResponse(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
  if (leaving) {
    response.cookies.delete({ name: APP_MODE_COOKIE, path: '/' });
  } else {
    response.cookies.set(APP_MODE_COOKIE, '1', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: APP_MODE_MAX_AGE,
    });
  }
  return response;
}
