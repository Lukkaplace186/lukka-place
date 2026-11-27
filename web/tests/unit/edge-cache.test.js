import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { BROWSER_CACHE_CONTROL, CDN_CACHE_CONTROL, edgeCacheable, isPersonalCookie } from '@/lib/edgeCache';
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_LOGGED_IN_FLAG } from '@/lib/customerAuth';
import { AGENT_SESSION_COOKIE, AGENT_LOGGED_IN_FLAG_COOKIE } from '@/lib/agentAuth';
import { ADMIN_SESSION_COOKIE } from '@/lib/adminAuth';
import { IMPERSONATION_COOKIE } from '@/lib/impersonationToken';
import { DEMO_COOKIE } from '@/lib/demoPhone';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { URL_LOCALE_HEADER } from '@/lib/i18n/urlLocale';

/**
 * Edge caching of anonymous public HTML (lib/edgeCache.js, 2026-11-21). The
 * one thing that must never happen: a page rendered for one visitor's cookies
 * marked cacheable, so Cloudflare serves it to the next visitor.
 */

// A real NextRequest: the proxy reads nextUrl, method, headers and cookies.
function requestFor(pathname, { search = '', cookies = {}, headers = {}, method = 'GET' } = {}) {
  const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  return new NextRequest(`http://localhost:3002${pathname}${search}`, {
    method,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  });
}

const cached = (response) => response.headers.get('CDN-Cache-Control') === CDN_CACHE_CONTROL;

test('every cookie that changes the server render is personal; tracking cookies are not', () => {
  for (const name of [CUSTOMER_SESSION_COOKIE, CUSTOMER_LOGGED_IN_FLAG, AGENT_SESSION_COOKIE, AGENT_LOGGED_IN_FLAG_COOKIE, ADMIN_SESSION_COOKIE, IMPERSONATION_COOKIE, DEMO_COOKIE, 'lp_staff']) {
    assert.equal(isPersonalCookie(name, 'x'), true, name);
  }
  assert.equal(LOCALE_COOKIE, 'NEXT_LOCALE');
  assert.equal(isPersonalCookie(LOCALE_COOKIE, 'en'), true, 'English renders English under the same URL');
  assert.equal(isPersonalCookie(LOCALE_COOKIE, 'fr'), false, 'French is the default render');
  for (const name of ['lp_vid', 'lp_consent', '_fbp', '_fbc', 'ttclid', 'lp_ref', 'lp_adq']) {
    assert.equal(isPersonalCookie(name, 'x'), false, name);
  }
});

test('the anonymous home, search, listing, landing, price-guide and guide pages are cacheable', () => {
  for (const [pathname, search] of [
    ['/', ''], ['/listings', '?commune=gombe&page=2'], ['/listings/734', ''], ['/listings/appartement-gombe-734', ''],
    ['/location', ''], ['/location/appartements/gombe', ''], ['/vente/terrains', ''],
    ['/combien-coute', ''], ['/combien-coute/loyer-gombe', ''], ['/guides', ''], ['/guides/louer-a-kinshasa', ''],
  ]) {
    const response = middleware(requestFor(pathname, { search, cookies: { lp_vid: 'abc', NEXT_LOCALE: 'fr' } }));
    assert.ok(cached(response), `${pathname}${search} should be edge-cacheable`);
    assert.equal(response.headers.get('Cache-Control'), BROWSER_CACHE_CONTROL, 'the browser still revalidates every time');
  }
});

test('a request with any personal cookie, a client-side navigation or a write is never cacheable', () => {
  const personal = [
    { [CUSTOMER_SESSION_COOKIE]: 'v1.token' },
    { [CUSTOMER_LOGGED_IN_FLAG]: '1' },
    { [AGENT_SESSION_COOKIE]: 'v1.token' },
    { [AGENT_LOGGED_IN_FLAG_COOKIE]: '1' },
    { [DEMO_COOKIE]: '1.2.3' },
    { lp_staff: '1' },
    { [LOCALE_COOKIE]: 'en' },
    { lukka_something_new: 'x' },
    // The store app (lp_app, lib/appModeRules.js on the app branch) renders its own bars.
    { lp_app: '1' },
  ];
  for (const cookies of personal) {
    const response = middleware(requestFor('/listings/734', { cookies }));
    assert.equal(cached(response), false, `cached with ${Object.keys(cookies)[0]}`);
    assert.equal(response.headers.get('Cache-Control'), null, 'Next keeps its own private, no-store');
  }
  // The app also announces itself in its user agent, cookie or not.
  assert.equal(cached(middleware(requestFor('/listings/734', { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13; wv) LukkaPlaceApp/1.4' } }))), false, 'the app user agent');
  assert.ok(cached(middleware(requestFor('/listings/734', { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile' } }))), 'a phone browser is cached');
  for (const headers of [{ rsc: '1' }, { 'next-router-prefetch': '1' }, { 'next-router-state-tree': '%5B%5D' }, { 'next-url': '/x' }, { [URL_LOCALE_HEADER]: 'en' }]) {
    assert.equal(cached(middleware(requestFor('/listings', { headers }))), false, JSON.stringify(headers));
  }
  assert.equal(cached(middleware(requestFor('/listings', { search: '?_rsc=abc' }))), false, '_rsc query');
  assert.equal(edgeCacheable({ method: 'POST', pathname: '/listings/734', headers: new Headers(), cookies: [] }), false);
});

test('every other path keeps private, no-store: accounts, chat, English URLs, image routes', () => {
  for (const pathname of ['/favoris', '/messages', '/trouver-pour-moi', '/a-propos', '/listings/734/opengraph-image-ixmui2', '/api/listings', '/agents/12']) {
    assert.equal(edgeCacheable({ method: 'GET', pathname, headers: new Headers(), cookies: [] }), false, pathname);
  }
  // /en/… is rewritten with the English header and sets the locale cookie.
  const english = middleware(requestFor('/en/rent/apartments/gombe'));
  assert.equal(cached(english), false);
  // /compte is gated before the cache decision is ever reached.
  assert.equal(cached(middleware(requestFor('/compte/connexion'))), false);
});

test('web/CLAUDE.md carries the Cloudflare rule with the same cookie bypass', () => {
  const doc = readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8');
  const section = doc.slice(doc.indexOf('### Edge caching of anonymous HTML'));
  assert.ok(section.length > 100, 'the section exists');
  for (const needle of ['http.cookie contains "lukka_"', 'http.cookie contains "lp_staff"', 'http.cookie contains "NEXT_LOCALE=en"']) {
    assert.ok(section.includes(needle), needle);
  }
});
