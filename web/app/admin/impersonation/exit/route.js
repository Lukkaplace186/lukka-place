import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { recordAudit } from '@/lib/adminAudit';
import { consolePathFor } from '@/lib/impersonation';
import { endImpersonationFromCookies } from '@/lib/impersonationCookies';

export const dynamic = 'force-dynamic';

/**
 * Leave "view as": end the session record, clear the cookies it set, and go
 * back to that person's page in the console. Public in middleware.js so it
 * still works when the admin session has expired underneath it; GET too,
 * because middleware sends an expired impersonation cookie here.
 */
async function exit() {
  const cookieStore = await cookies();
  let destination = '/admin/dashboard';
  try {
    const result = await endImpersonationFromCookies(cookieStore, 'exit');
    if (result?.parsed) destination = consolePathFor(result.parsed.targetType, result.parsed.targetId);
    if (result?.ended) {
      const started = new Date(result.ended.started_at).getTime();
      await recordAudit(
        { id: Number(result.ended.admin_user_id), shared: false, name: result.ended.admin_name, email: result.ended.admin_email },
        {
          action: 'impersonation.end',
          entityType: result.parsed.targetType,
          entityId: result.parsed.targetId,
          details: {
            sessionId: result.parsed.sessionId,
            reason: result.parsed.expired ? 'expired' : 'exit',
            durationSeconds: Math.max(0, Math.round((Date.now() - started) / 1000)),
          },
        },
      );
    }
  } catch (err) {
    console.error(`[impersonation] exit failed: ${err.message}`);
  }
  // A relative Location, like middleware.js's own redirects: behind nginx,
  // request.url carries the upstream host (localhost:3002), and an absolute
  // redirect built from it sent the browser there.
  return new NextResponse(null, { status: 303, headers: { Location: destination } });
}

export const GET = exit;
export const POST = exit;
