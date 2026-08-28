import { NextResponse } from 'next/server';
import { isValidSessionToken, ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';
import { isValidCustomerSessionToken, CUSTOMER_SESSION_COOKIE } from '@/lib/customerAuth';
import { isValidAgentSessionToken, AGENT_SESSION_COOKIE } from '@/lib/agentAuth';

/**
 * Gates /admin/* (team password), /compte/agent/* (agent self-service
 * phone+password), and /compte/* (customer phone+password) behind their own
 * session cookies. One middleware.js per Next.js app root, so this branches
 * by path prefix rather than being three files. The agent branch is checked
 * before the general /compte branch — /compte/agent/* is a sub-path of
 * /compte/*, and it needs the agent cookie checked, not the customer one.
 * Explicit Node.js runtime (not the default Edge runtime) so the
 * `node:crypto` primitives every auth module here uses (HMAC,
 * timingSafeEqual) are guaranteed available, rather than relying on Edge's
 * crypto polyfill.
 */
export const config = {
  matcher: ['/admin/:path*', '/compte/:path*'],
  runtime: 'nodejs',
};

const PUBLIC_COMPTE_PATHS = new Set(['/compte/connexion', '/compte/inscription']);
const PUBLIC_AGENT_PATHS = new Set([
  '/compte/agent/connexion',
  '/compte/agent/inscription',
  '/compte/agent/inscription/verifier',
]);

export function middleware(request) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') {
      return NextResponse.next();
    }

    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (isValidSessionToken(token)) {
      return NextResponse.next();
    }

    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('next', pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/compte/agent')) {
    if (PUBLIC_AGENT_PATHS.has(pathname)) {
      return NextResponse.next();
    }

    const token = request.cookies.get(AGENT_SESSION_COOKIE)?.value;
    if (isValidAgentSessionToken(token)) {
      return NextResponse.next();
    }

    const loginUrl = new URL('/compte/agent/connexion', request.url);
    loginUrl.searchParams.set('next', pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith('/compte')) {
    if (PUBLIC_COMPTE_PATHS.has(pathname)) {
      return NextResponse.next();
    }

    const token = request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
    if (isValidCustomerSessionToken(token)) {
      return NextResponse.next();
    }

    const loginUrl = new URL('/compte/connexion', request.url);
    loginUrl.searchParams.set('next', pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
