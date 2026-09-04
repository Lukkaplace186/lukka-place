/**
 * Module resolution for the test tiers — the ESM analogue of the engine's
 * scripts/verify-pipeline.js `stubPackage()` (which swaps packages at the
 * require-cache level for CommonJS). Two jobs:
 *
 *   1. Resolve the `@/…` alias from jsconfig.json. Next/Turbopack applies it
 *      at build time; plain `node --test` has never heard of it, so ~30
 *      lib modules would fail to resolve without this.
 *   2. In the *unit* tier only, redirect `lib/db.js` to a recording fake
 *      pool. lib/db.js is the single chokepoint — every DB-touching module
 *      does `import { getPool } from './db'` — so substituting the module
 *      (not the `pg` package) isolates every one of them at once.
 *
 * `module.registerHooks` (Node 22.15+/24) is the synchronous, in-thread hook
 * API: no worker thread, no message port, so the fake pool's recorded calls
 * are directly readable from the test. Verified present on this Node
 * (v24.19.0) before this was written.
 *
 * `import 'server-only'` is NOT handled here and needs no stub: that package
 * ships an `exports` map with a "react-server" condition pointing at a
 * zero-byte file, so `node --conditions=react-server` makes it a genuine
 * no-op. See tests/README.md.
 */
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_POOL_URL = pathToFileURL(path.join(WEB_ROOT, 'tests', 'support', 'fakePool.js')).href;

/**
 * Unit tier redirects lib/db.js; http/chain tiers do not (they talk to a
 * real pool on purpose). Driven by an env var rather than a separate hooks
 * file so both tiers share one resolution implementation.
 */
const FAKE_DB = process.env.QA_FAKE_DB === '1';

/** Does this resolved URL point at web/lib/db.js, however it was specified? */
function isDbModule(url) {
  if (!url.startsWith('file:')) return false;
  const p = path.resolve(fileURLToPath(url));
  return p === path.join(WEB_ROOT, 'lib', 'db.js');
}

/** Apply the fake-pool redirect if this URL is lib/db.js and we're in the unit tier. */
function maybeFakeDb(url) {
  return FAKE_DB && isDbModule(url) ? FAKE_POOL_URL : url;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // `@/lib/x` -> <web>/lib/x. Next resolves the extension implicitly; plain
    // Node ESM does not, so add it here.
    if (specifier.startsWith('@/')) {
      let target = path.join(WEB_ROOT, specifier.slice(2));
      if (!path.extname(target)) target += '.js';
      return { url: maybeFakeDb(pathToFileURL(target).href), shortCircuit: true };
    }

    // Extensionless *relative* imports (`./db`, `../lib/format`) are the same
    // bundler affordance, and this codebase uses them throughout. Plain Node
    // ESM requires the extension, so retry once with `.js` when the real
    // resolver can't find it — rather than pre-emptively rewriting every
    // relative specifier, which would wrongly claim directory imports and
    // bare package names too.
    try {
      const resolved = nextResolve(specifier, context);
      return { ...resolved, url: maybeFakeDb(resolved.url) };
    } catch (err) {
      // Retry once with an explicit .js. Two distinct cases, both of which
      // Next resolves implicitly and plain Node ESM does not:
      //   - relative imports written without an extension (./db), used
      //     throughout lib/
      //   - a package subpath absent from its own exports map, where Node
      //     falls back to legacy path resolution and lands on an
      //     extensionless file (next/server -> next/server.js)
      if (path.extname(specifier)) throw err;
      try {
        const retried = nextResolve(specifier + ".js", context);
        return { ...retried, url: maybeFakeDb(retried.url) };
      } catch {
        throw err;
      }
    }
  },
});
