import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

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
 */

const ROOT = process.cwd();

const LAYOUTS = [
  { layout: 'app/(site)/layout.js', constant: 'SITE_NAMESPACES' },
  { layout: 'app/admin/layout.js', constant: 'ADMIN_NAMESPACES' },
  { layout: 'app/compte/agent/layout.js', constant: 'AGENT_NAMESPACES' },
];

/** Namespaces the ROOT layout gives every surface, so no subtree restates them. */
const ROOT_NAMESPACES = ['common', 'nav', 'footer'];

function read(file) {
  try {
    return readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    return null;
  }
}

/** Resolve an import specifier to a real file in this app. */
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(fromFile.split(path.sep).join('/')), spec);
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
 * Every file reachable from `entry` by import, plus the route files that sit
 * under the layout's own directory — a layout renders its sibling pages via
 * `children`, which is not an import edge.
 */
function reachableFrom(entry) {
  const dir = path.posix.dirname(entry.split(path.sep).join('/'));
  const seeds = execSync(`find "${dir}" -name "*.js" -o -name "*.jsx"`, { encoding: 'utf8', cwd: ROOT })
    .trim().split('\n').filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'));

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

function declaredNamespaces(layoutSrc, constant) {
  const m = layoutSrc.match(new RegExp(`${constant}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

for (const { layout, constant } of LAYOUTS) {
  test(`${layout} declares every namespace its client components resolve`, () => {
    const layoutSrc = read(layout);
    assert.ok(layoutSrc, `${layout} should exist`);

    const declared = declaredNamespaces(layoutSrc, constant);
    assert.ok(declared, `${layout} should define ${constant}`);

    const available = new Set([...declared, ...ROOT_NAMESPACES]);

    const missing = new Map();
    for (const file of reachableFrom(layout)) {
      const src = read(file);
      if (!src || !isClient(src)) continue; // server code holds the whole dictionary
      for (const ns of namespacesIn(src)) {
        if (!available.has(ns)) {
          if (!missing.has(ns)) missing.set(ns, []);
          missing.get(ns).push(file);
        }
      }
    }

    assert.deepEqual(
      [...missing.keys()].sort(),
      [],
      `${layout}: client components resolve namespaces this layout does not provide.\n` +
        [...missing].map(([ns, files]) => `  '${ns}' <- ${files.slice(0, 4).join(', ')}`).join('\n'),
    );
  });
}
