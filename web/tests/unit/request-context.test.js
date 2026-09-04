import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceFromUserAgent, sourceFromRequest, analyticsDimensions } from '@/lib/requestContext';

/**
 * These two dimensions feed the numbers the business intends to sell, so
 * they are pinned against real User-Agent and Referer strings rather than
 * invented ones.
 */

test('real phone User-Agents are classified as mobile', () => {
  const uas = [
    // iPhone, Safari
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    // Android phone, Chrome — the common case in Kinshasa
    'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    // Opera Mini, still widely used on low-bandwidth connections
    'Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; en) Presto/2.12.423 Version/12.16',
  ];
  for (const ua of uas) assert.equal(deviceFromUserAgent(ua), 'mobile', ua.slice(0, 40));
});

test('tablets are not counted as mobile', () => {
  // An Android tablet is identified by the ABSENCE of "Mobile", which is the
  // easy case to get backwards.
  assert.equal(
    deviceFromUserAgent(
      'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ),
    'tablet',
  );
  assert.equal(
    deviceFromUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1',
    ),
    'tablet',
  );
});

test('desktop browsers are classified as desktop', () => {
  assert.equal(
    deviceFromUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ),
    'desktop',
  );
});

test('crawlers are bucketed separately so they never inflate audience figures', () => {
  const bots = [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/122.0.0.0 Safari/537.36',
  ];
  for (const ua of bots) assert.equal(deviceFromUserAgent(ua), 'bot', ua.slice(0, 40));
});

test('a missing User-Agent yields null, never a guessed bucket', () => {
  assert.equal(deviceFromUserAgent(undefined), null);
  assert.equal(deviceFromUserAgent(''), null);
  assert.equal(deviceFromUserAgent(null), null);
});

test('a utm_source campaign label wins over the referrer', () => {
  assert.equal(
    sourceFromRequest({ referer: 'https://www.google.com/search?q=maison', utmSource: 'Facebook_Ads' }),
    'facebook_ads',
  );
});

test('only the referrer HOST is kept — never the visitor search terms', () => {
  const source = sourceFromRequest({ referer: 'https://www.google.com/search?q=maison+a+louer+gombe' });
  assert.equal(source, 'google.com');
  assert.ok(!source.includes('maison'), 'the query string must never be stored');
});

test('internal navigation is not a traffic source', () => {
  assert.equal(
    sourceFromRequest({ referer: 'https://lukkaplace.com/listings', selfHost: 'lukkaplace.com' }),
    'direct',
  );
  assert.equal(
    sourceFromRequest({ referer: 'https://www.lukkaplace.com/listings', selfHost: 'lukkaplace.com' }),
    'direct',
  );
});

test('no referrer is "direct" — a real answer, not a missing one', () => {
  assert.equal(sourceFromRequest({}), 'direct');
  assert.equal(sourceFromRequest({ referer: '' }), 'direct');
});

test('a malformed Referer never throws', () => {
  assert.equal(sourceFromRequest({ referer: 'not a url' }), 'direct');
});

test('analyticsDimensions reads headers, not the request body', () => {
  const headers = new Headers({
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Mobile/15E148',
    referer: 'https://m.facebook.com/',
    host: 'lukkaplace.com',
  });
  assert.deepEqual(analyticsDimensions(headers), { device: 'mobile', source: 'm.facebook.com' });
});
