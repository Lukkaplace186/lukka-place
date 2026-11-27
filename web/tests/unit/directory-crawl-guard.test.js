import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { middleware, config } from '@/middleware';
import robots from '@/app/robots';
import {
  DIRECTORY_FILTER_KEYS,
  isFilteredDirectoryRequest,
  isMetaAddress,
  isNamedCrawler,
  looksLikeImpersonatedChrome,
} from '@/lib/directoryCrawlGuard';

// Crawlers on /agents filter combinations (lib/directoryCrawlGuard.js, 2026-11-24).

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0 Mobile/15E148 Safari/604.1';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)';

const headersOf = (obj) => new Headers(obj);

function request(pathname, search, headers) {
  const url = `http://localhost:3002${pathname}${search}`;
  return {
    method: 'GET',
    url,
    headers: headersOf(headers),
    nextUrl: { pathname, search, searchParams: new URL(url).searchParams },
    cookies: { get: () => undefined },
  };
}

test('a filtered directory URL is one with a filter key; the plain directory and its pages are not', () => {
  const p = (s) => new URLSearchParams(s);
  assert.equal(isFilteredDirectoryRequest('/agents', p('communes=Gombe,Limete&offre=vente')), true);
  assert.equal(isFilteredDirectoryRequest('/en/agents', p('verifies=1')), true);
  assert.equal(isFilteredDirectoryRequest('/agents', p('commune=Gombe')), true);
  assert.equal(isFilteredDirectoryRequest('/agents', p('')), false);
  assert.equal(isFilteredDirectoryRequest('/agents', p('page=2')), false, 'pagination leads to the profiles');
  assert.equal(isFilteredDirectoryRequest('/agents/12', p('offre=vente')), false, 'a profile is never caught');
  assert.equal(isFilteredDirectoryRequest('/listings', p('communes=Gombe')), false);
});

test('Chrome without Sec-Fetch-Mode is a script wearing its name; real browsers and named bots are not', () => {
  assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': CHROME_MAC })), true);
  assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': CHROME_MAC, 'sec-fetch-mode': 'navigate' })), false);
  assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': CHROME_ANDROID, 'sec-fetch-mode': 'cors' })), false, 'a client-side navigation');
  assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': CHROME_IOS })), false, 'iOS Chrome sends no Sec-Fetch on older iOS');
  assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': SAFARI })), false);
  assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': GPTBOT })), false, 'a bot that names itself is always welcome');
  assert.equal(looksLikeImpersonatedChrome(headersOf({})), false);
  assert.equal(looksLikeImpersonatedChrome(null), false);
});

test('middleware refuses a fake Chrome on a filtered search before anything renders', () => {
  const res = middleware(request('/agents', '?communes=Selembao%2CKisenso&verifies=1', { 'user-agent': CHROME_MAC }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('x-lukka-crawl-guard'), 'directory-filters');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('the English directory is guarded the same way', () => {
  const res = middleware(request('/en/agents', '?offre=vente', { 'user-agent': CHROME_MAC }));
  assert.equal(res.status, 403);
});

test('a real browser on the same filtered search goes through', () => {
  const res = middleware(request('/agents', '?communes=Gombe&offre=location', { 'user-agent': CHROME_ANDROID, 'sec-fetch-mode': 'navigate' }));
  assert.notEqual(res.status, 403);
  assert.equal(res.headers.get('x-lukka-crawl-guard'), null);
});

test('the matcher carries every filter key, literally (Next reads it at build time)', () => {
  const keys = config.matcher
    .filter((m) => typeof m === 'object' && m.source === '/agents')
    .map((m) => m.has[0].key);
  assert.deepEqual(keys, DIRECTORY_FILTER_KEYS);
  const src = fs.readFileSync(path.join(WEB, 'middleware.js'), 'utf8');
  const literal = [...src.matchAll(/\{ source: '\/agents', has: \[\{ type: 'query', key: '([a-z]+)' \}\] \}/g)].map((m) => m[1]);
  assert.deepEqual(literal, DIRECTORY_FILTER_KEYS);
});

// Owner 2026-11-24: chatbots bring direct customers; search engines and AI
// assistants are never closed out or turned away.
const GOOGLEBOT = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const BINGBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36';
const REFLECTIONBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Reflectionbot/1.0; +https://reflection.ai) Chrome/151.0.0.0 Safari/537.36';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

test('search engines and AI crawlers that put "Chrome" in their user agent are never refused', () => {
  for (const ua of [GOOGLEBOT, BINGBOT, REFLECTIONBOT, GPTBOT]) {
    assert.equal(looksLikeImpersonatedChrome(headersOf({ 'user-agent': ua })), false, ua.slice(0, 60));
    const res = middleware(request('/agents', '?communes=Gombe&offre=vente', { 'user-agent': ua }));
    assert.notEqual(res.status, 403, ua.slice(0, 60));
  }
});

test("Meta's network is never refused, even with a plain Chrome user agent (Meta AI, link previews)", () => {
  assert.equal(isMetaAddress('2a03:2880:f800:5::1'), true);
  assert.equal(isMetaAddress('69.171.250.12'), true);
  assert.equal(isMetaAddress('5.88.1.2'), false);
  const viaTraefik = { 'user-agent': WINDOWS_CHROME, 'x-forwarded-for': '2a03:2880:f800:5::1' };
  assert.equal(looksLikeImpersonatedChrome(headersOf(viaTraefik)), false);
  const elsewhere = { 'user-agent': WINDOWS_CHROME, 'x-forwarded-for': '5.88.1.2' };
  assert.equal(looksLikeImpersonatedChrome(headersOf(elsewhere)), true);
});

test('the named-crawler test never mistakes a real browser for a bot', () => {
  for (const ua of [CHROME_MAC, CHROME_ANDROID, WINDOWS_CHROME, SAFARI, CHROME_IOS]) assert.equal(isNamedCrawler(ua), false, ua.slice(0, 50));
  for (const ua of [GOOGLEBOT, BINGBOT, REFLECTIONBOT, GPTBOT, 'facebookexternalhit/1.1', 'WhatsApp/2.23.20', 'meta-externalagent/1.1']) {
    assert.equal(isNamedCrawler(ua), true, ua.slice(0, 50));
  }
});

test('robots.txt keeps the whole public site open, the directory filters included', () => {
  const { rules } = robots();
  const all = rules.find((r) => r.userAgent === '*');
  assert.deepEqual(all.disallow, ['/admin', '/compte', '/api/', '/r/', '/messages']);
  assert.ok(!all.disallow.some((p) => p.startsWith('/agents') || p.startsWith('/en/agents')), 'no directory page is closed');
  const blocked = rules.filter((r) => r.userAgent !== '*').flatMap((r) => r.userAgent);
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Googlebot', 'Bingbot', 'Reflectionbot', 'meta-externalagent']) {
    assert.ok(!blocked.includes(bot), `${bot} is welcome everywhere public`);
  }
});

test('the filter links stay ordinary links (no nofollow steering crawlers away)', () => {
  const page = fs.readFileSync(path.join(WEB, 'app', '(portfolio)', 'agents', 'page.js'), 'utf8');
  assert.doesNotMatch(page, /rel="nofollow"/);
});
