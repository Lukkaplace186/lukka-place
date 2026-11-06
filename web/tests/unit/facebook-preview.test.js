import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  _resetFacebookPreviewCache, facebookAppToken, facebookDebuggerUrl, readScrapeAnswer, refreshFacebookPreview,
} from '@/lib/facebookPreview';
import { TEAM_SOCIAL_SOURCE, listingPublicUrl } from '@/lib/listingShareCopy';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

/**
 * Facebook's link preview, made before the post (2026-11-05): two of three
 * team posts showed a bare "lukkaplace.com" box because Facebook's first read
 * of those links failed and it caches that read per URL.
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const URL_651 = 'https://lukkaplace.com/listings/651?utm_source=lukka_reseaux';
const ENV = { FACEBOOK_APP_ID: '123', FACEBOOK_APP_SECRET: 'abc' };
const GOOD = {
  title: '150 $ / jour — 2 chambres — Appartement à louer à Gombe',
  image: [{ url: 'https://lukkaplace.com/listings/651/opengraph-image-ixmui2?e7a1', width: 1200, height: 630 }],
};
const noWait = async () => {};

function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next instanceof Error) throw next;
    return { ok: !next.error, status: next.error ? 400 : 200, json: async () => next };
  };
  return { impl, calls };
}

test('the app token comes from FACEBOOK_APP_TOKEN, else id|secret, else none', () => {
  assert.equal(facebookAppToken({ FACEBOOK_APP_TOKEN: ' tok ' }), 'tok');
  assert.equal(facebookAppToken(ENV), '123|abc');
  assert.equal(facebookAppToken({ FACEBOOK_APP_ID: '123' }), null);
  assert.equal(facebookAppToken({}), null);
});

test('a scrape is ready only with a real title and an image', () => {
  assert.equal(readScrapeAnswer(GOOD).status, 'ready');
  assert.equal(readScrapeAnswer({ title: GOOD.title }).status, 'no_image');
  // Facebook's failed-read placeholder: the domain as the title.
  assert.equal(readScrapeAnswer({ title: 'lukkaplace.com', image: GOOD.image }).status, 'failed');
  assert.equal(readScrapeAnswer({ error: { message: 'Invalid OAuth access token' } }).status, 'failed');
  assert.equal(readScrapeAnswer(null).status, 'failed');
});

test('no Facebook app configured: nothing is called', async () => {
  _resetFacebookPreviewCache();
  const { impl, calls } = fakeFetch([GOOD]);
  const result = await refreshFacebookPreview(URL_651, { env: {}, fetchImpl: impl, wait: noWait });
  assert.equal(result.status, 'unconfigured');
  assert.equal(calls.length, 0);
});

test('the exact caption URL is scraped, a failed read is retried, a good one cached', async () => {
  _resetFacebookPreviewCache();
  const { impl, calls } = fakeFetch([{ title: 'lukkaplace.com' }, GOOD]);
  const result = await refreshFacebookPreview(URL_651, { env: ENV, fetchImpl: impl, wait: noWait });
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/$/);
  assert.deepEqual(calls[0].body, { id: URL_651, scrape: 'true', access_token: '123|abc' });
  const again = await refreshFacebookPreview(URL_651, { env: ENV, fetchImpl: impl, wait: noWait });
  assert.equal(again.status, 'ready');
  assert.equal(calls.length, 2, 'a good read is not asked again');
});

test('three failed reads report failure; a refused token stops at once; never throws', async () => {
  _resetFacebookPreviewCache();
  const failing = fakeFetch([new Error('socket hang up')]);
  assert.equal((await refreshFacebookPreview(URL_651, { env: ENV, fetchImpl: failing.impl, wait: noWait })).status, 'failed');
  assert.equal(failing.calls.length, 3);
  const refused = fakeFetch([{ error: { message: 'Invalid OAuth access token.', type: 'OAuthException' } }]);
  assert.equal((await refreshFacebookPreview(URL_651, { env: ENV, fetchImpl: refused.impl, wait: noWait })).status, 'failed');
  assert.equal(refused.calls.length, 1);
});

test('the debugger link carries the encoded URL', () => {
  assert.equal(
    facebookDebuggerUrl(URL_651),
    'https://developers.facebook.com/tools/debug/?q=https%3A%2F%2Flukkaplace.com%2Flistings%2F651%3Futm_source%3Dlukka_reseaux',
  );
});

test('the kit exposes the feed caption link, and the actions scrape only that', () => {
  assert.equal(listingPublicUrl(651, { source: TEAM_SOCIAL_SOURCE }), URL_651);
  assert.match(read('lib/marketing/shareKit.js'), /socialUrl: urlFor\('social'\)/);
  for (const file of ['app/admin/listings/shareActions.js', 'app/compte/agent/shareActions.js']) {
    assert.match(read(file), /refreshFacebookPreview\(kit\.socialUrl\)/, file);
  }
  const dialog = read('components/ListingQuickShare.js');
  assert.match(dialog, /team \? refreshTeamFacebookPreviewAction : refreshFacebookPreviewAction/);
  assert.match(dialog, /if \(!open \|\| !feed \|\| sold\) return undefined;/);
});

test('both dictionaries carry the preview lines', () => {
  for (const dict of [fr, en]) {
    for (const key of ['fbChecking', 'fbReady', 'fbNotReady', 'fbDebugger']) {
      assert.ok(dict.agent.quickShare[key], key);
    }
  }
});
