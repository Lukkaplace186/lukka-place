'use client';

import { useEffect, useState } from 'react';

/**
 * The search box's parser (lib/searchParser.js) and Kinshasa place gazetteer
 * (lib/gazetteer.js), loaded after the page has painted instead of in its
 * first download (2026-11-26, phone speed: ~25 KB of compressed JS, a third of
 * it place names, on every visit to / and /listings — competing with the hero
 * photo on a 3G phone). Nothing reads them until someone types, so:
 *
 * - `useSearchEngine()` starts the download once the window has loaded and
 *   the browser is idle, and re-renders with the module when it arrives
 *   (null until then) — whoever started the download;
 * - `loadSearchEngine()` is what an input's focus and every submit await, so
 *   a visitor who types before the idle download still gets the real parser,
 *   never a guess;
 * - `searchEngineNow()` is the module if it is already here, for code that
 *   must stay synchronous.
 *
 * One download per page load, shared by every caller.
 */
let loaded = null;
let pending = null;
const listeners = new Set();

export function loadSearchEngine() {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = Promise.all([import('./searchParser'), import('./gazetteer')])
      .then(([parser, gazetteer]) => {
        loaded = {
          parseSearchQuery: parser.parseSearchQuery,
          searchGazetteer: gazetteer.searchGazetteer,
          findLocationMention: gazetteer.findLocationMention,
        };
        for (const listener of listeners) listener(loaded);
        return loaded;
      })
      .catch((err) => {
        // A failed chunk (offline, a deploy swapped the files) is retried
        // on the next call rather than remembered.
        pending = null;
        throw err;
      });
  }
  return pending;
}

export function searchEngineNow() {
  return loaded;
}

function whenIdle(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

export function useSearchEngine() {
  const [engine, setEngine] = useState(loaded);
  useEffect(() => {
    if (loaded) {
      setEngine(loaded);
      return undefined;
    }
    listeners.add(setEngine);
    let cancelIdle = null;
    const start = () => {
      cancelIdle = whenIdle(() => loadSearchEngine().catch(() => {}));
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      listeners.delete(setEngine);
      cancelIdle?.();
      window.removeEventListener('load', start);
    };
  }, []);
  return engine;
}
