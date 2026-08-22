import { NextResponse } from 'next/server';
import { isValidSessionToken, ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';
import { isValidCustomerSessionToken, CUSTOMER_SESSION_COOKIE } from '@/lib/customerAuth';

/**
 * Gates /admin/* (team password) and /compte/* (customer phone+password)
 * behind their own session cookies. One middleware.js per Next.js app root,
 * so this branches by path prefix rather than being two files. Explicit
 * Node.js runtime (not the default Edge runtime) so the `node:crypto`
 * primitives both auth modules use (HMAC, timingSafeEqual) are guaranteed
 * available, rather than relying on Edge's crypto polyfill.
 */
export const config = {
  matcher: ['/admin/:path*', '/compte/:path*'],
  runtime: 'nodejs',
};

const PUBLIC_COMPTE_PATHS = new Set(['/compte/connexion', '/compte/inscription']);

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
