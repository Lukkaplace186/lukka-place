import test from 'node:test';
import assert from 'node:assert/strict';
import { middleware, config } from '@/middleware';
import { createAgentSessionToken, AGENT_SESSION_COOKIE } from '@/lib/agentAuth';
import { createCustomerSessionToken, CUSTOMER_SESSION_COOKIE } from '@/lib/customerAuth';
import { createSessionToken, ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';

/**
 * middleware.js is the single gate in front of all three private realms. It
 * imports only next/server plus the three auth modules and touches exactly
 * three things on the request (nextUrl.pathname, nextUrl.search,
 * cookies.get(name)?.value), so it can be driven directly with a hand-built
 * request object — no browser, no dev server.
 */

function requestFor(pathname, { search = '', cookies = {} } = {}) {
  return {
    nextUrl: { pathname, search },
    url: `http://localhost:3002${pathname}${search}`,
    cookies: { get: (name) => (name in cookies ? { value: cookies[name] } : undefined) },
  };
}

/** @returns {{redirected: boolean, location: URL|null}} */
function outcome(response) {
  const location = response.headers.get('location');
  return { redirected: Boolean(location), location: location ? new URL(location) : null };
}

test('the matcher covers exactly the private realms', () => {
  assert.deepEqual(config.matcher, ['/admin/:path*', '/compte/:path*']);
  assert.equal(config.runtime, 'nodejs', 'node:crypto primitives require the Node runtime, not Edge');
});

test('/admin/login stays public — no redirect loop', () => {
  assert.equal(outcome(middleware(requestFor('/admin/login'))).redirected, false);
});

test('an unauthenticated admin page redirects to login carrying the original path', () => {
  const { redirected, location } = outcome(middleware(requestFor('/admin/dashboard')));
  assert.equal(redirected, true);
  assert.equal(location.pathname, '/admin/login');
  assert.equal(location.searchParams.get('next'), '/admin/dashboard');
});

test('the next param preserves the query string, not just the path', () => {
  const { location } = outcome(middleware(requestFor('/admin/listings', { search: '?status=pending' })));
  assert.equal(location.searchParams.get('next'), '/admin/listings?status=pending');
});

test('a valid admin session passes through', () => {
  const req = requestFor('/admin/dashboard', { cookies: { [ADMIN_SESSION_COOKIE]: createSessionToken() } });
  assert.equal(outcome(middleware(req)).redirected, false);
});

test('agent public paths stay reachable', () => {
  for (const p of ['/compte/agent/connexion', '/compte/agent/inscription', '/compte/agent/inscription/verifier']) {
    assert.equal(outcome(middleware(requestFor(p))).redirected, false, `${p} must be public`);
  }
});

test('an unauthenticated agent page redirects to the AGENT login, not the customer one', () => {
  const { location } = outcome(middleware(requestFor('/compte/agent/biens')));
  assert.equal(location.pathname, '/compte/agent/connexion');
});

test('an unauthenticated customer page redirects to the customer login', () => {
  const { location } = outcome(middleware(requestFor('/compte/client/favoris')));
  assert.equal(location.pathname, '/compte/connexion');
  assert.equal(location.searchParams.get('next'), '/compte/client/favoris');
});

test('customer public paths stay reachable', () => {
  for (const p of ['/compte/connexion', '/compte/inscription']) {
    assert.equal(outcome(middleware(requestFor(p))).redirected, false);
  }
});

/**
 * /compte/agent/* is a sub-path of /compte/*, and the agent branch is checked
 * first (middleware.js:52). Swapping those two blocks is a plausible future
 * edit that would silently hand every logged-in customer the agent dashboard,
 * so the ordering is pinned here rather than left to code review.
 */
test('a valid CUSTOMER session must not open the agent dashboard', () => {
  const customerToken = createCustomerSessionToken({ customerId: 7, tokenVersion: 0 });
  const req = requestFor('/compte/agent/biens', { cookies: { [CUSTOMER_SESSION_COOKIE]: customerToken } });
  const { redirected, location } = outcome(middleware(req));
  assert.equal(redirected, true, 'a customer cookie must not satisfy the agent gate');
  assert.equal(location.pathname, '/compte/agent/connexion');
});

test('a valid agent session opens the agent dashboard', () => {
  const token = createAgentSessionToken({ agentId: 7, tokenVersion: 0 });
  const req = requestFor('/compte/agent/biens', { cookies: { [AGENT_SESSION_COOKIE]: token } });
  assert.equal(outcome(middleware(req)).redirected, false);
});

test('an AGENT session must not open a customer portal page', () => {
  const token = createAgentSessionToken({ agentId: 7, tokenVersion: 0 });
  const req = requestFor('/compte/client/favoris', { cookies: { [AGENT_SESSION_COOKIE]: token } });
  assert.equal(outcome(middleware(req)).redirected, true);
});

test('a garbage cookie is treated as no cookie', () => {
  const req = requestFor('/admin/dashboard', { cookies: { [ADMIN_SESSION_COOKIE]: 'not-a-token' } });
  assert.equal(outcome(middleware(req)).redirected, true);
});
