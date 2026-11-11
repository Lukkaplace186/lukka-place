import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { APP_TABS, activeAppTab, hidesAppTabs, isAppMode, isAppUserAgent } from '@/lib/appModeRules';

/**
 * App mode (2026-11-11): inside the store app the site draws a bottom tab bar
 * instead of the footer. On by the cookie /app sets, or the app's user agent.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

test('app mode comes from the cookie or the app user agent, nothing else', () => {
  assert.equal(isAppMode({ cookieValue: '1' }), true);
  assert.equal(isAppMode({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile LukkaPlaceApp' }), true);
  assert.equal(isAppMode({ cookieValue: '0', userAgent: 'Mozilla/5.0 Chrome/131' }), false);
  assert.equal(isAppMode(), false);
  assert.equal(isAppUserAgent(null), false);
});

test('each path lights the right tab', () => {
  assert.equal(activeAppTab('/'), 'home');
  assert.equal(activeAppTab('/listings?commune=Gombe'), 'search');
  assert.equal(activeAppTab('/favoris'), 'favorites');
  assert.equal(activeAppTab('/compte/client/favoris'), 'favorites');
  assert.equal(activeAppTab('/compte/client/notifications/12'), 'notifications');
  assert.equal(activeAppTab('/compte/client/parametres'), 'account');
  assert.equal(activeAppTab('/compte/connexion'), 'account');
  assert.equal(activeAppTab('/a-propos'), null);
});

test('a listing page keeps its own bottom bar, so the tabs step aside', () => {
  assert.equal(hidesAppTabs('/listings/301'), true);
  assert.equal(hidesAppTabs('/listings'), false);
  assert.equal(hidesAppTabs('/'), false);
});

test('every tab label exists in both dictionaries', () => {
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const tab of APP_TABS) {
      const [ns, key] = tab.labelKey.split('.');
      assert.equal(typeof dict[ns][key], 'string', `${lang} ${tab.labelKey}`);
    }
    assert.equal(typeof dict.nav.appTabs, 'string', `${lang} nav.appTabs`);
  }
});

test('the site layout swaps the footer for the tabs in app mode, and /app sets the cookie', () => {
  assert.match(read('app/(site)/layout.js'), /\{app \? <AppTabBar \/> : <Footer \/>\}/);
  const route = read('app/app/route.js');
  assert.match(route, /cookies\.set\(APP_MODE_COOKIE, '1'/);
  assert.match(route, /cookies\.delete\(\{ name: APP_MODE_COOKIE/);
  const config = JSON.parse(read('../mobile/capacitor.config.json'));
  assert.equal(config.appendUserAgent, 'LukkaPlaceApp');
});

test('in the app the home page is an app screen, without the website marketing bands', () => {
  const page = read('app/(site)/(home)/page.js');
  assert.match(page, /if \(app\) return <AppHomePage /);
  const appHome = page.slice(page.indexOf('async function AppHomePage'), page.indexOf('export default async function HomePage'));
  assert.match(appHome, /<AppHomeTop/);
  assert.doesNotMatch(appHome, /HomeAlertBand|ValueProposition/);
  for (const lang of ['fr', 'en']) {
    const app = JSON.parse(read(`lib/i18n/${lang}.json`)).home.app;
    assert.match(app.greetingNamed, /\{name\}/, lang);
    for (const key of ['find', 'prices', 'projects', 'agencies']) assert.equal(typeof app.quick[key], 'string', `${lang} ${key}`);
  }
});

test('the tab bar shows unread alerts on Notifications and unread messages on Compte, signed in only', () => {
  const bar = read('components/AppTabBar.js');
  assert.match(bar, /useAlertsUnread\(\{ side: 'customer', loadNow: true, enabled: loggedIn \}\)/);
  assert.match(bar, /useChatUnread\('customer', \{ enabled: loggedIn \}\)/);
  assert.match(bar, /notifications: \{ count: unreadAlerts/);
  assert.match(bar, /account: \{ count: unreadMessages/);
  // The counts are read before the listing page's early return (hooks order).
  assert.ok(bar.indexOf('useAlertsUnread(') < bar.indexOf('if (hidesAppTabs(pathname)) return null'));
  const hook = read('lib/useAlertsUnread.js');
  assert.match(hook, /if \(!enabled\) return undefined;/);
  assert.match(hook, /if \(loadNow\) load\(\);/);
  for (const lang of ['fr', 'en']) {
    const label = JSON.parse(read(`lib/i18n/${lang}.json`)).nav.unreadNotifications;
    assert.match(label.other, /\{count\}/, lang);
  }
});
