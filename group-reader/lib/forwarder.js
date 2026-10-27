/**
 * POST one batch to the engine's `/internal/group-posts`.
 *
 * 2xx → done. 4xx → the engine refused this payload and will refuse it again:
 * logged and dropped. 5xx or a network error → retried with exponential
 * backoff (2s, 4s, 8s … capped at 2 min), up to `maxAttempts`; after that the
 * batch is logged loudly and dropped (its photos stay on disk).
 *
 * @returns {Promise<'sent'|'refused'|'failed'>}
 */

'use strict';

async function postGroupPost(payload, {
  engineUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 8,
  log = console,
} = {}) {
  const url = `${engineUrl.replace(/\/+$/, '')}/internal/group-posts`;
  const label = `${payload.groupName || payload.groupJid} / ${payload.posterName || payload.posterPhone || '?'} (${payload.wamids.length} msg, ${payload.photos.length} photo)`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let status = null;
    let detail = '';
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      status = res.status;
      if (res.ok) {
        log.log(`[group-reader] forwarded ${label} → ${status}`);
        return 'sent';
      }
      detail = (await res.text().catch(() => '')).slice(0, 300);
      if (status >= 400 && status < 500) {
        log.warn(`[group-reader] engine REFUSED ${label} → ${status} ${detail} — dropped`);
        return 'refused';
      }
    } catch (err) {
      detail = err.message;
    }
    if (attempt === maxAttempts) break;
    const wait = Math.min(2000 * 2 ** (attempt - 1), 120_000);
    log.warn(`[group-reader] engine unavailable for ${label} (${status ?? 'network'} ${detail}), retry ${attempt}/${maxAttempts - 1} in ${wait / 1000}s`);
    await sleep(wait);
  }
  log.error(`[group-reader] GAVE UP on ${label} after ${maxAttempts} attempts — wamids ${payload.wamids.join(',')}`);
  return 'failed';
}

module.exports = { postGroupPost };
