import { NextResponse } from 'next/server';
import { isValidSessionToken, ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';
import { isValidCustomerSessionToken, CUSTOMER_SESSION_COOKIE } from '@/lib/customerAuth';
import { isValidAgentSessionToken, AGENT_SESSION_COOKIE, AGENT_LOGGED_IN_FLAG_COOKIE, AGENT_SESSION_TTL_SECONDS } from '@/lib/agentAuth';
import { IMPERSONATION_COOKIE, impersonationDecision } from '@/lib/impersonationToken';
import { normaliseSearchAliases } from '@/lib/searchAliases';
import { refParamApplies, searchWithoutRef } from '@/lib/partnerRules';

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
  matcher: [
    '/admin/:path*',
    '/compte/:path*',
    // Every other page and API route too, but ONLY for a browser carrying the
    // "view as" cookie: while an admin views the site as another account, no
    // write may go through anywhere (lib/impersonationToken.js). Ordinary
    // storefront traffic never reaches this proxy.
    {
      source: '/((?!_next/static|_next/image|favicon\\.ico).*)',
      has: [{ type: 'cookie', key: 'lukka_impersonation' }],
    },
    // /listings?city=…&location=… — aliases redirected onto the real
    // ville / commune params (lib/searchAliases.js). Only URLs carrying one
    // reach the proxy; ordinary searches never do.
    { source: '/listings', has: [{ type: 'query', key: 'city' }] },
    { source: '/listings', has: [{ type: 'query', key: 'location' }] },
    // `?ref=CODE` on any page — a partner's code (lib/partnerRules.js), sent
    // through /go so the click is counted and the code remembered. Only URLs
    // carrying one reach the proxy.
    {
      source: '/((?!_next/static|_next/image|favicon\\.ico|api/|go/|r/).*)',
      has: [{ type: 'query', key: 'ref' }],
    },
  ],
  runtime: 'nodejs',
};

// '/compte/inscription/verifier' is public for the same reason
// '/compte/agent/inscription/verifier' below is: it is the step that comes
// BEFORE a session exists. Signup deliberately does not log anyone in until
// a WhatsApp code proves the number, so gating this page on a session would
// bounce every new customer straight back to a login they cannot pass yet.
// Its own guard is the signed attempt cookie (lib/verifyAttempt.js), which
// is what actually says who is mid-verification.
const PUBLIC_COMPTE_PATHS = new Set([
  '/compte/connexion',
  '/compte/inscription',
  '/compte/inscription/verifier',
  // A customer account created on WhatsApp sets its first password here,
  // before any session exists; guarded by the single-use token in its URL.
  '/compte/activer',
]);
const PUBLIC_AGENT_PATHS = new Set([
  '/compte/agent/connexion',
  '/compte/agent/inscription',
  '/compte/agent/inscription/verifier',
  // The WhatsApp magic-link landing page. Necessarily public: its whole
  // purpose is to let an agent who has never had a password set one. It is
  // not unguarded — it is gated by the single-use activation token in its own
  // URL, checked against a hash in Postgres with a real expiry (see
  // lib/agents.js's consumeAgentActivationToken).
  '/compte/agent/activer',
]);

// /admin/activate is where an invited team member sets their first password —
// necessarily reachable before a session exists, and gated instead by the
// single-use activation token in its URL (lib/adminUsers.js).
// /admin/impersonation/exit must work even after the admin session itself has
// expired: it ends the "view as" record and clears the cookies it set.
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/admin/activate', '/admin/impersonation/exit']);

/**
 * Passes the request through with `x-admin-pathname` set, so the admin layout
 * can decide which section is being opened and whether this role may open it.
 * Always overwritten here, so a client cannot supply its own.
 */
function nextWithAdminPath(request, pathname) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-admin-pathname', pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * `lp_staff=1`, path `/`: marks this browser as the Lukka Place team's, so the
 * storefront's event beacons (which never see the /admin-scoped session
 * cookie) store its views as `viewer_kind = 'staff'` (lib/trackIngest.js).
 * A label, not a credential — it grants nothing, and a visitor who set it
 * would only relabel their own views. Refreshed while the session is used.
 */
const STAFF_MARKER_MAX_AGE = 30 * 24 * 60 * 60;
function withStaffMarker(request, response) {
  if (request.cookies.get('lp_staff')?.value !== '1') {
    response.cookies.set('lp_staff', '1', {
      path: '/',
      maxAge: STAFF_MARKER_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
    });
  }
  return response;
}

export function middleware(request) {
  const { pathname, search } = request.nextUrl;

  const impersonation = impersonationDecision({
    method: request.method,
    pathname,
    token: request.cookies.get(IMPERSONATION_COOKIE)?.value,
  });
  if (impersonation === 'block') {
    return new NextResponse('Mode « voir en tant que » : lecture seule, aucune modification n’est enregistrée.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-lukka-impersonation': 'read-only' },
    });
  }
  if (impersonation === 'exit') {
    return NextResponse.redirect(new URL('/admin/impersonation/exit', request.url));
  }

  // A partner code on any page: counted and remembered by /go, which lands
  // back on this page without it. Agent signup keeps its own `?ref=` (a sales
  // rep's code that prefills the form).
  if (request.method === 'GET' && request.nextUrl.searchParams?.has('ref') && refParamApplies(pathname)) {
    const code = request.nextUrl.searchParams.get('ref') || '';
    const back = `${pathname}${searchWithoutRef(search)}`;
    const target = new URL(`/go/${encodeURIComponent(code.slice(0, 40)) || '-'}`, request.url);
    target.searchParams.set('via', 'param');
    target.searchParams.set('to', back);
    return NextResponse.redirect(target, 307);
  }

  if (pathname === '/listings') {
    const normalised = normaliseSearchAliases(request.nextUrl.searchParams);
    if (normalised !== null) {
      const target = request.nextUrl.clone();
      target.search = normalised;
      return NextResponse.redirect(target, 308);
    }
  }

  if (pathname.startsWith('/admin')) {
    if (PUBLIC_ADMIN_PATHS.has(pathname)) {
      return nextWithAdminPath(request, pathname);
    }

    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    if (isValidSessionToken(token)) {
      return withStaffMarker(request, nextWithAdminPath(request, pathname));
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
      const response = NextResponse.next();
      // Sessions opened before the header flag existed get it here, so the
      // menu shows "Mon espace agent" after one visit to the dashboard.
      if (request.cookies.get(AGENT_LOGGED_IN_FLAG_COOKIE)?.value !== '1') {
        response.cookies.set(AGENT_LOGGED_IN_FLAG_COOKIE, '1', {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
          maxAge: AGENT_SESSION_TTL_SECONDS,
        });
      }
      return response;
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
