import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { storedPosition } from '@/lib/listingPin';

/**
 * Public JS diet (2026-11-21, web/CLAUDE.md "Mobile performance" →
 * "Public JS and HTML diet"). Visitors pay ~$10/GB on Congolese mobile data;
 * these pin what was taken off the JavaScript every public page loads before
 * it can be used, by walking the STATIC import graph (`from '…'` — a
 * next/dynamic `import('…')` is a separate chunk fetched later, so it does
 * not count) from the public shell and the main public pages.
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

function resolve(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(fromFile), spec);
  else return { pkg: spec };
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}/index.js`]) {
    if (existsSync(path.join(ROOT, candidate)) && /\.(js|jsx|mjs)$/.test(candidate)) return { file: candidate };
  }
  return { missing: base };
}

const isClient = (src) => /^\s*['"]use client['"]/.test(src);

/**
 * Everything the BROWSER loads up front for these route files: client
 * components reachable through static imports, and every module those import
 * statically (packages included, by name).
 */
function browserStaticGraph(seeds) {
  const serverSeen = new Set();
  const clientRoots = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (serverSeen.has(file)) continue;
    serverSeen.add(file);
    const src = read(file);
    if (isClient(src)) { clientRoots.add(file); continue; }
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const r = resolve(m[1], file);
      if (r.file) queue.push(r.file);
    }
  }
  const files = new Set();
  const packages = new Set();
  const edges = [];
  const q2 = [...clientRoots];
  while (q2.length) {
    const file = q2.pop();
    if (files.has(file)) continue;
    files.add(file);
    const src = read(file);
    // Either quote: the shadcn primitives in components/ui use double quotes.
    for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      const r = resolve(m[1], file);
      if (r.pkg) { packages.add(r.pkg); edges.push([file, r.pkg]); } else if (r.file) { edges.push([file, r.file]); q2.push(r.file); }
    }
  }
  return { files, packages, edges, whoImports: (target) => edges.filter(([, to]) => to === target || to.startsWith(target)).map(([from]) => from) };
}

const SHELL = ['app/layout.js', 'app/(site)/layout.js'];
const PUBLIC_PAGES = {
  home: [...SHELL, 'app/(site)/(home)/layout.js', 'app/(site)/(home)/page.js'],
  listings: [...SHELL, 'app/(site)/listings/(search)/(results)/page.js'],
  listing: [...SHELL, 'app/(site)/listings/[id]/layout.js', 'app/(site)/listings/[id]/page.js'],
};

test('no animation library on a public page: Motion / framer-motion are not in any public static graph', () => {
  for (const [name, seeds] of Object.entries(PUBLIC_PAGES)) {
    const { packages, whoImports } = browserStaticGraph(seeds);
    for (const pkg of packages) {
      assert.ok(!/^(framer-motion|motion)(\/|$)/.test(pkg), `${name}: ${pkg} is loaded up front by ${whoImports(pkg).join(', ')}`);
    }
  }
});

test('the public shell loads no Radix: the drawer and the account menu are on-demand chunks', () => {
  const shell = browserStaticGraph(SHELL);
  const radix = [...shell.packages].filter((p) => p === 'radix-ui' || p.startsWith('@radix-ui/'));
  assert.deepEqual(radix, [], `Radix in the shell via ${radix.map((p) => shell.whoImports(p).join(', ')).join('; ')}`);
  for (const f of ['components/ui/sheet.jsx', 'components/ui/dropdown-menu.jsx', 'components/ui/dialog.jsx', 'lib/constants.js']) {
    assert.ok(!shell.files.has(f), `${f} is in every public page's JavaScript (imported by ${shell.whoImports(f).join(', ')})`);
  }
  const header = read('components/Header.js');
  assert.match(header, /const loadDrawer = \(\) => import\('\.\/HeaderDrawer'\);/);
  assert.match(header, /dynamic\(loadDrawer, \{ ssr: false \}\)/);
  assert.match(header, /import\('\.\/HeaderAccountMenu'\)/);
  // The ☰ starts fetching on intent and keeps its accessible name and state.
  assert.match(header, /onPointerDown=\{warmDrawer\}/);
  assert.match(header, /aria-haspopup="dialog"\s+aria-expanded=\{menuOpen\}/);
  // Focus returns to the ☰ when the drawer closes (SheetTrigger used to do it).
  assert.match(read('components/HeaderDrawer.js'), /returnFocusRef\?\.current\?\.focus\(\)/);
});

test('sheets and dialogs opened on a tap are not in the up-front JavaScript of listing pages', () => {
  for (const name of ['home', 'listings', 'listing']) {
    const g = browserStaticGraph(PUBLIC_PAGES[name]);
    for (const f of ['components/WhatsAppIntentPanel.js', 'components/VisitRequestDialog.js', 'components/HeaderDrawer.js', 'components/HeaderAccountMenu.js']) {
      assert.ok(!g.files.has(f), `${name}: ${f} is loaded up front by ${g.whoImports(f).join(', ')}`);
    }
  }
  const sheet = read('components/WhatsAppIntentSheet.js');
  assert.doesNotMatch(sheet, /from '@\/components\/ui\/sheet'|from '@\/components\/PhoneField'/);
  assert.match(sheet, /const loadPanel = \(\) => import\('\.\/WhatsAppIntentPanel'\);/);
  const card = read('components/EnquiryCard.js');
  assert.doesNotMatch(card, /import VisitRequestDialog from/);
  assert.match(card, /const loadVisitDialog = \(\) => import\('\.\/VisitRequestDialog'\);/);
  // The listing page's main actions are warmed while idle, never under Data Saver.
  assert.match(sheet, /if \(!standalone \|\| !href \|\| prefersLightData\(\)\) return undefined;/);
  assert.match(card, /if \(prefersLightData\(\)\) return undefined;/);
});

test('the listing page no longer ships the geocoder to read two stored numbers', () => {
  const g = browserStaticGraph(PUBLIC_PAGES.listing);
  for (const f of ['lib/geocoding.js', 'lib/mapViewport.js']) {
    assert.ok(!g.files.has(f), `${f} is loaded up front by ${g.whoImports(f).join(', ')}`);
  }
  // Same answers as through resolveMarkerPosition.
  assert.deepEqual(storedPosition({ latitude: '-4.3', longitude: '15.3' }), { lat: -4.3, lng: 15.3, approximate: false });
  assert.equal(storedPosition({ latitude: 0, longitude: 0 }), null);
  assert.equal(storedPosition({ latitude: '95', longitude: '15' }), null, 'out of range is not a stored position');
  assert.equal(storedPosition({ latitude: '', longitude: '15' }), null);
  assert.equal(storedPosition({}), null);
});
