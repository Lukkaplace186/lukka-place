import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 2026-11-22: the store app's chrome and the after-WhatsApp sheet load on
 * demand. Imported statically, they put Motion and Radix in the first load
 * of every website page (measured live: JS only −7 % after the public diet).
 * components/app/AppChrome.js holds the loaders; a Server Component's own
 * dynamic() is not code-split (Next 16 lazy-loading guide), so the server
 * pages must import from it, never from the components themselves.
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// page -> [its own loader module, the components it takes from it]. One module
// per place, so a layout's import graph holds only what that layout draws
// (i18n-namespaces.test.js decides from that graph which texts it ships).
const APP_ONLY = {
  'app/(site)/layout.js': ['AppChrome', ['AppTabBar', 'AppTopBar', 'AppMotion', 'AppPullToRefresh']],
  'app/(site)/(home)/page.js': ['AppHomeTopLazy', ['AppHomeTop']],
  'app/(site)/listings/[id]/page.js': ['AppListingChrome', ['AppListingHeader', 'AppListingBar']],
  'app/(site)/commune/[slug]/page.js': ['AppGuideHeaderLazy', ['AppGuideHeader']],
};

test('public pages take the app chrome from the on-demand loaders, never directly', () => {
  for (const [file, [loader, names]] of Object.entries(APP_ONLY)) {
    const source = read(file);
    const chrome = read(`components/app/${loader}.js`);
    assert.match(chrome, /^'use client';/, `${loader}: the loaders must live in a client module to be split`);
    for (const name of names) {
      assert.ok(chrome.includes(`export const ${name} = dynamic(() => import(`), `${name} has a loader in ${loader}`);
      assert.doesNotMatch(source, new RegExp(`^import ${name} from`, 'm'), `${file} imports ${name} directly`);
    }
    assert.ok(source.includes(`from '@/components/app/${loader}';`), `${file} uses ${loader}`);
  }
});

test('the results list loads the app card (Motion) only when it draws one', () => {
  const view = read('components/ListingsSplitView.js');
  assert.match(view, /const AppListingCard = dynamic\(\(\) => import\('\.\/app\/AppListingCard'\)\);/);
  assert.doesNotMatch(view, /^import AppListingCard from/m);
});

test('the after-WhatsApp sheet is fetched on the tap and mounted only when it opens', () => {
  const prompt = read('components/ContactSignupPrompt.js');
  assert.doesNotMatch(prompt, /components\/ui\/sheet/, 'no Radix in the prompt mounted on every page');
  assert.match(prompt, /const ContactSignupSheet = dynamic\(loadSheet, \{ ssr: false \}\);/);
  assert.match(prompt, /loadSheet\(\)\.catch\(\(\) => \{\}\);\n\s+loadForm\(\)\.catch/, 'both chunks are fetched while the visitor is in WhatsApp');
  assert.match(prompt, /if \(!mounted\) return null;/);
  assert.match(read('components/ContactSignupSheet.js'), /from '@\/components\/ui\/sheet'/);
});
