import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };
import { createTranslator } from '@/lib/i18n/translate';

/**
 * Each layout hands the browser only the dictionary namespaces its own subtree
 * renders (lib/i18n/server.js's getMessages), which is what keeps /admin's copy
 * out of a public visitor's payload — ~6KB gzip on every public page.
 *
 * The failure mode that buys is silent: a client component resolving a key
 * whose namespace its layout never provided gets the raw dot-path back, warned
 * about in dev and invisible in production. That happened once already — the
 * public /listings heading resolves `search.label.*` through ResultsHeader, and
 * the (site) layout did not list `search`.
 *
 * So this walks the REAL import graph from each layout, collects every
 * namespace the reachable CLIENT components reference, and asserts the layout
 * declares them. It is deliberately graph-based rather than a hardcoded list:
 * a hardcoded list would need updating by the same person who forgot the
 * namespace in the first place.
 *
 * **The LAYOUT LIST is now discovered the same way, and for the same reason.**
 * It used to be three hardcoded entries, which left app/(portfolio)/layout.js
 * — a route group that mounted no I18nProvider AT ALL — entirely unchecked.
 * /agents/[id] renders PropertyCard, so real public visitors saw raw
 * `listings.facts.bathrooms`, `listings.freshness.today` and
 * `account.requests.call` dot-paths on the page. A hardcoded list cannot catch
 * a surface nobody remembered to add to it, and "mounts no provider" is the
 * case most worth catching: it fails for every key at once, not one.
 */

const ROOT = process.cwd();

const BACKSLASH = String.fromCharCode(92);
const toPosix = (p) => p.split(BACKSLASH).join('/');

function read(file) {
  try {
    return readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

/** Every layout.js in the app — discovered, never listed. */
function allLayouts() {
  return execSync('find app -name "layout.js"', { encoding: 'utf8', cwd: ROOT })
    .trim().split('\n').filter(Boolean)
    .map(toPosix)
    .sort();
}

/** The layouts wrapping `file`, outermost first. app/layout.js is always index 0. */
function ancestorLayouts(file, layouts) {
  const dir = path.posix.dirname(toPosix(file));
  return layouts
    .filter((l) => {
      const ldir = path.posix.dirname(l);
      return dir === ldir || dir.startsWith(`${ldir}/`);
    })
    .sort((a, b) => a.length - b.length);
}

/**
 * What a layout hands the BROWSER: the array passed to getI18n(), resolved
 * through the constant it is normally stored in.
 *
 * A layout with no I18nProvider declares nothing — a legitimate choice (an
 * inner layout can rely entirely on its parent, as app/(site)/compte/client
 * does) but NOT an exemption: its subtree still has to be covered by an
 * ancestor, which is exactly what the assertion below checks.
 */
function declaredNamespaces(layoutSrc) {
  if (!/I18nProvider/.test(layoutSrc)) return [];
  const asList = (s) => s.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);

  const viaConstant = layoutSrc.match(/getI18n\(\s*([A-Za-z_$][\w$]*)\s*\)/);
  if (viaConstant) {
    const decl = layoutSrc.match(new RegExp(`${viaConstant[1]}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (decl) return asList(decl[1]);
  }
  const inline = layoutSrc.match(/getI18n\(\s*\[([^\]]*)\]\s*\)/);
  return inline ? asList(inline[1]) : [];
}

/** Resolve an import specifier to a real file in this app. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(toPosix(fromFile)), spec);
  else return null; // node_modules

  for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`]) {
    if (existsSync(path.join(ROOT, candidate)) && /\.(js|jsx)$/.test(candidate)) return candidate;
  }
  return null;
}

function isClient(src) {
  return src.trimStart().startsWith("'use client'") || src.trimStart().startsWith('"use client"');
}

/**
 * A `'use server'` file is a Server Action: it is IMPORTED by client components
 * but never runs in the browser, so its t() calls resolve against the whole
 * dictionary via getT() and prove nothing about what a layout must ship.
 * Counting them reported `errors` missing from /admin, which was noise.
 */
function isServerAction(src) {
  return src.trimStart().startsWith("'use server'") || src.trimStart().startsWith('"use server"');
}

/**
 * The route files a layout is directly responsible for: everything under its
 * own directory that no DEEPER layout claims first, since a deeper layout adds
 * its own namespaces on top (I18nProvider merges). Without that exclusion the
 * root layout would be held responsible for /admin's copy.
 *
 * A layout renders these via `children`, which is not an import edge — hence
 * the filesystem seed rather than a pure graph walk.
 */
function ownRouteFiles(layout, layouts) {
  const dir = path.posix.dirname(layout);
  return execSync(`find "${dir}" -name "*.js" -o -name "*.jsx"`, { encoding: 'utf8', cwd: ROOT })
    .trim().split('\n').filter(Boolean)
    .map(toPosix)
    .filter((f) => {
      const chain = ancestorLayouts(f, layouts);
      return chain[chain.length - 1] === layout;
    });
}

/** Everything reachable by import from `seeds`, plus the seeds themselves. */
function reachableFrom(seeds) {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    if (!src) continue;
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const target = resolveImport(m[1], file);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/** Namespaces a file's own t()/labelKey references touch. */
function namespacesIn(src) {
  const found = new Set();
  for (const m of src.matchAll(/[^\w.]t\(\s*'([a-zA-Z]+)\./g)) found.add(m[1]);
  for (const m of src.matchAll(/labelKey:\s*'([a-zA-Z]+)\./g)) found.add(m[1]);
  return found;
}

/** The namespaces a layout's client subtree actually resolves, file by file. */
function clientNamespacesUnder(layout, layouts) {
  const found = new Map();
  for (const file of reachableFrom(ownRouteFiles(layout, layouts))) {
    const src = read(file);
    if (!src || !isClient(src) || isServerAction(src)) continue; // server code holds the whole dictionary
    for (const ns of namespacesIn(src)) {
      if (!found.has(ns)) found.set(ns, []);
      found.get(ns).push(file);
    }
  }
  return found;
}

const LAYOUTS = allLayouts();

test('every layout in the app is covered by this test', () => {
  // Not a formality: the bug this file failed to catch was a whole route group
  // missing from a hardcoded list. Assert discovery found the real ones.
  assert.ok(LAYOUTS.includes('app/layout.js'), 'root layout should be discovered');
  assert.ok(LAYOUTS.includes('app/(portfolio)/layout.js'), '(portfolio) layout should be discovered');
  assert.ok(LAYOUTS.length >= 5, `expected every app layout, found ${LAYOUTS.length}: ${LAYOUTS}`);
});

for (const layout of LAYOUTS) {
  test(`${layout} — its client components resolve only namespaces it or an ancestor provides`, () => {
    const chain = ancestorLayouts(layout, LAYOUTS);

    // Merged, because I18nProvider merges: a nested layout inherits its
    // parent's namespaces and only has to declare what it adds.
    const available = new Set();
    for (const ancestor of chain) {
      const src = read(ancestor);
      assert.ok(src, `${ancestor} should exist`);
      for (const ns of declaredNamespaces(src)) available.add(ns);
    }

    const missing = new Map();
    for (const [ns, files] of clientNamespacesUnder(layout, LAYOUTS)) {
      if (!available.has(ns)) missing.set(ns, files);
    }

    assert.deepEqual(
      [...missing.keys()].sort(),
      [],
      `${layout}: client components resolve namespaces no layout in its chain provides.\n` +
        `  chain:     ${chain.join(' -> ')}\n` +
        `  available: ${[...available].sort().join(', ') || '(none)'}\n` +
        [...missing].map(([ns, files]) => `  '${ns}' <- ${files.slice(0, 4).join(', ')}`).join('\n'),
    );
  });
}

/**
 * The specific regression, asserted end to end rather than only structurally:
 * these three keys rendered as raw dot-paths on the public agency profile.
 * The check mirrors what actually ships — getMessages picks the layout's
 * namespaces out of the dictionary, and the browser's translator is built
 * from THAT subset, with no French fallback to hide a gap (the client
 * provider is handed one locale, see lib/i18n/client.js).
 */
const PORTFOLIO_REGRESSION_KEYS = [
  'listings.facts.bathrooms',
  'listings.freshness.today',
  'account.requests.call',
];

for (const locale of ['fr', 'en']) {
  test(`/agents/[id] resolves the previously-raw keys in ${locale}`, () => {
    const layoutSrc = read('app/(portfolio)/layout.js');
    const available = new Set();
    for (const ancestor of ancestorLayouts('app/(portfolio)/layout.js', LAYOUTS)) {
      for (const ns of declaredNamespaces(read(ancestor))) available.add(ns);
    }

    const dictionary = locale === 'fr' ? fr : en;
    const shipped = {};
    for (const ns of available) if (dictionary[ns] !== undefined) shipped[ns] = dictionary[ns];

    // No fallbackMessages — the browser genuinely has none.
    const t = createTranslator({ locale, messages: shipped });

    for (const key of PORTFOLIO_REGRESSION_KEYS) {
      const value = t(key);
      assert.notEqual(value, key, `${key} rendered as its own dot-path in ${locale} on /agents/[id]`);
      assert.ok(value.trim().length > 0, `${key} rendered empty in ${locale}`);
    }

    assert.match(layoutSrc, /I18nProvider/, '(portfolio) layout must mount a provider');
  });
}
