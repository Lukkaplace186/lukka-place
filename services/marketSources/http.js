'use strict';

/**
 * services/marketSources/http.js — the only way a market collector reads
 * another website.
 *
 * - **One request at a time per site, spaced.** `minIntervalMs` per host, and
 *   never less than the site's own robots.txt Crawl-delay (IMCongo asks for
 *   10 s). A collection is a few hundred requests spread over the night, not
 *   a burst.
 * - **robots.txt is read at run time and obeyed.** A path its `User-agent: *`
 *   group disallows is never fetched, so a site that closes a section closes
 *   it to us the same night. Unreadable robots.txt (404, network) = no rules,
 *   which is what the standard says.
 * - **Identifies itself** with a link back to the site, never a browser
 *   string. No cookies, no login, nothing a visitor could not read.
 *
 * Which sites are collected at all is decided by their terms of use, not
 * here — see services/marketObservations.js, "SOURCES".
 */

const USER_AGENT = 'LukkaPlaceMarketBot/1.0 (+https://lukkaplace.com)';
const DEFAULT_TIMEOUT_MS = 30 * 1000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The `User-agent: *` group of a robots.txt, as { disallow: string[], allow: string[], crawlDelayMs }.
 * Exported for the tests.
 */
function parseRobots(text) {
  const rules = { disallow: [], allow: [], crawlDelayMs: 0 };
  let inStar = false;
  let sawRuleInGroup = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      // Consecutive User-agent lines share one group; a User-agent after a
      // rule starts a new group.
      if (sawRuleInGroup) { inStar = false; sawRuleInGroup = false; }
      if (value === '*') inStar = true;
      continue;
    }
    sawRuleInGroup = true;
    if (!inStar) continue;
    if (field === 'disallow' && value) rules.disallow.push(value);
    else if (field === 'allow' && value) rules.allow.push(value);
    else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) rules.crawlDelayMs = Math.min(seconds, 60) * 1000;
    }
  }
  return rules;
}

/** robots.txt path pattern → RegExp ('*' wildcard, '$' end anchor). */
function patternRegExp(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching rule wins; Allow wins a tie (RFC 9309). */
function robotsAllows(rules, pathAndQuery) {
  let best = { length: -1, allow: true };
  for (const [list, allow] of [[rules.disallow, false], [rules.allow, true]]) {
    for (const pattern of list) {
      if (!patternRegExp(pattern).test(pathAndQuery)) continue;
      const length = pattern.length;
      if (length > best.length || (length === best.length && allow)) best = { length, allow };
    }
  }
  return best.allow;
}

/**
 * A polite fetcher for one collection run.
 *
 * @param {{minIntervalMs?: number, fetchImpl?: typeof fetch, sleepImpl?: Function, timeoutMs?: number}} [options]
 */
function createFetcher({ minIntervalMs = 3000, fetchImpl = fetch, sleepImpl = sleep, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const robotsByOrigin = new Map();
  const lastAtByOrigin = new Map();
  let requests = 0;

  async function raw(url) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json,application/xml;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    requests += 1;
    return response;
  }

  async function robotsFor(origin) {
    if (robotsByOrigin.has(origin)) return robotsByOrigin.get(origin);
    let rules = { disallow: [], allow: [], crawlDelayMs: 0 };
    try {
      const response = await raw(`${origin}/robots.txt`);
      if (response.ok) rules = parseRobots(await response.text());
    } catch {
      // Unreachable robots.txt: no rules, per the standard. The page request
      // that follows will fail on its own if the site is down.
    }
    robotsByOrigin.set(origin, rules);
    lastAtByOrigin.set(origin, Date.now());
    return rules;
  }

  async function get(url) {
    const parsed = new URL(url);
    const rules = await robotsFor(parsed.origin);
    if (!robotsAllows(rules, `${parsed.pathname}${parsed.search}`)) {
      const err = new Error(`robots.txt disallows ${parsed.pathname}`);
      err.code = 'ROBOTS_DISALLOWED';
      throw err;
    }
    const gap = Math.max(minIntervalMs, rules.crawlDelayMs);
    const last = lastAtByOrigin.get(parsed.origin) || 0;
    const wait = last + gap - Date.now();
    if (wait > 0) await sleepImpl(wait);
    lastAtByOrigin.set(parsed.origin, Date.now());
    const response = await raw(url);
    if (!response.ok) {
      const err = new Error(`${parsed.host} answered ${response.status} for ${parsed.pathname}`);
      err.status = response.status;
      throw err;
    }
    return response;
  }

  return {
    async text(url) { return (await get(url)).text(); },
    async json(url) {
      const response = await get(url);
      return { body: await response.json(), headers: response.headers };
    },
    get requests() { return requests; },
  };
}

module.exports = { USER_AGENT, createFetcher, parseRobots, robotsAllows };
