import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { APP_TABS, activeAppTab, hidesAppTabs, isAppMode, isAppUserAgent } from '@/lib/appModeRules';

/**
 * App mode (2026-11-11): inside the store app the site draws a bottom tab bar
 * instead of the footer. On by the cookie /app sets, or the app's user agent.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
read.exists = (rel) => existsSync(path.join(process.cwd(), rel));

test('app mode comes from the cookie or the app user agent, nothing else', () => {
  assert.equal(isAppMode({ cookieValue: '1' }), true);
  assert.equal(isAppMode({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile LukkaPlaceApp' }), true);
  assert.equal(isAppMode({ cookieValue: '0', userAgent: 'Mozilla/5.0 Chrome/131' }), false);
  assert.equal(isAppMode(), false);
  assert.equal(isAppUserAgent(null), false);
});

test('each path lights the right tab (Search, Saved, Account — the app design)', () => {
  assert.deepEqual(APP_TABS.map((tab) => tab.key), ['search', 'saved', 'account']);
  assert.equal(activeAppTab('/'), 'search');
  assert.equal(activeAppTab('/listings?commune=Gombe'), 'search');
  assert.equal(activeAppTab('/favoris'), 'saved');
  assert.equal(activeAppTab('/compte/client/favoris'), 'saved');
  assert.equal(activeAppTab('/compte/client/alertes'), 'saved');
  assert.equal(activeAppTab('/compte/menu'), 'account');
  assert.equal(activeAppTab('/compte/client/notifications/12'), 'account');
  assert.equal(activeAppTab('/compte/connexion'), 'account');
  assert.equal(activeAppTab('/a-propos'), null);
});

test('a listing page keeps its own bottom bar, so the tabs step aside', () => {
  assert.equal(hidesAppTabs('/listings/301'), true);
  assert.equal(hidesAppTabs('/listings'), false);
  assert.equal(hidesAppTabs('/'), false);
});

test('every tab label exists in both dictionaries', () => {
  const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const tab of APP_TABS) assert.equal(typeof lookup(dict, tab.labelKey), 'string', `${lang} ${tab.labelKey}`);
    assert.equal(typeof dict.nav.appTabs, 'string', `${lang} nav.appTabs`);
    assert.equal(typeof dict.appShell.bell, 'string', `${lang} appShell.bell`);
  }
});

test('the site layout swaps the footer for the tabs in app mode, and /app sets the cookie', () => {
  const layout = read('app/(site)/layout.js');
  assert.match(layout, /\{app \? \(\s*<Suspense fallback=\{null\}>\s*<AppTabBar \/>\s*<\/Suspense>\s*\) : \(\s*<Footer \/>/);
  assert.match(layout, /\{app \? \(\s*<AppTopBar \/>\s*\) : \(\s*<Header /, 'the app top bar replaces the header');
  assert.match(layout, /const Chrome = app \? AppMotion : Passthrough/, 'motion only in app mode');
  assert.match(layout, /'appShell'/, 'the app wording ships with the site namespaces');
  const route = read('app/app/route.js');
  assert.match(route, /cookies\.set\(APP_MODE_COOKIE, '1'/);
  assert.match(route, /cookies\.delete\(\{ name: APP_MODE_COOKIE/);
  const config = JSON.parse(read('../mobile/capacitor.config.json'));
  assert.equal(config.appendUserAgent, 'LukkaPlaceApp');
});

test('in the app the home page is the design search home, on real data', () => {
  const page = read('app/(site)/(home)/page.js');
  assert.match(page, /if \(app\) return <AppHomePage /);
  const appHome = page.slice(page.indexOf('async function AppHomePage'), page.indexOf('export default async function HomePage'));
  assert.match(appHome, /<AppHomeTop/);
  assert.match(appHome, /cachedLiveListingsCount\(\)/, 'the band states the real live count');
  assert.match(appHome, /latestSavedSearch\(\)/);
  assert.doesNotMatch(appHome, /HomeAlertBand|ValueProposition/);
  const top = read('components/AppHomeTop.js');
  assert.match(top, /liveCount > 0 \?/, 'no count line at 0');
  // The entrance moves, never fades: the server HTML must show the search card.
  const rise = top.slice(top.indexOf('const rise'), top.indexOf('};', top.indexOf('const rise')));
  assert.doesNotMatch(rise, /opacity/);
  for (const lang of ['fr', 'en']) {
    const app = JSON.parse(read(`lib/i18n/${lang}.json`)).appShell;
    assert.match(app.home.count.other, /\{count\}/, lang);
    for (const key of ['title', 'continue', 'latest', 'seeAll', 'findTitle', 'findText']) assert.equal(typeof app.home[key], 'string', `${lang} ${key}`);
  }
});

test('unread app alerts sit on the top bar bell, unread messages on the Account tab, signed in only', () => {
  const top = read('components/app/AppTopBar.js');
  assert.match(top, /useAlertsUnread\(\{ side: 'customer', loadNow: true, enabled: loggedIn \}\)/);
  assert.match(top, /compte\/connexion\?next=/, 'signed out, the bell asks to sign in first');
  const bar = read('components/AppTabBar.js');
  assert.match(bar, /useChatUnread\('customer', \{ enabled: loggedIn \}\)/);
  assert.match(bar, /tab\.key === 'account' \? unreadMessages : 0/);
  assert.match(bar, /layoutId="app-tab-active"/, 'the active marker slides between tabs');
  // The counts are read before the listing page's early return (hooks order).
  assert.ok(bar.indexOf('useChatUnread(') < bar.indexOf('if (hidesAppTabs(pathname) || mapView) return null'));
  const hook = read('lib/useAlertsUnread.js');
  assert.match(hook, /if \(!enabled\) return undefined;/);
  assert.match(hook, /if \(loadNow\) load\(\);/);
});

test('the account menu is public, and shows private rows only with a session', () => {
  assert.match(read('middleware.js'), /'\/compte\/menu',/);
  const page = read('app/(site)/compte/menu/page.js');
  assert.match(page, /getPortalCustomer\(\)/);
  assert.match(page, /\{portal \? \(\s*<Group title=\{t\('appShell\.account\.yourSpace'\)\}>/);
  assert.match(page, /<form action=\{logoutAction\}>/);
  assert.match(page, /meta=\{counts\?\.viewings \?\? null\}/, 'an unknown count is left out, not 0');
});

test('motion is in the app only, and respects reduced motion', () => {
  assert.match(read('components/app/AppMotion.js'), /reducedMotion="user"/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies.motion, 'motion is a dependency');
  assert.match(read('lib/appFont.js'), /preload: false/, 'the website never downloads the serif');
});

test('Saved in the app: the design screen, except a shared selection link', () => {
  const page = read('app/(site)/favoris/page.js');
  assert.match(page, /if \(!shared && \(await isAppRequest\(\)\)\) return <AppSavedScreen accountSearches=\{await accountSearches\(\)\} \/>/);
  assert.match(page, /return <FavorisView \/>/);
  const screen = read('components/app/AppSavedScreen.js');
  // The same stores the website reads: the account when signed in, this phone otherwise.
  assert.match(screen, /useSyncExternalStore\(subscribeFavorites, getFavoriteIds/);
  assert.match(screen, /fetch\(`\/api\/listings\?ids=\$\{key\}`\)/, 'saved listings come through the public gate');
  assert.match(screen, /t\('appShell\.saved\.gone', \{ count: gone \}\)/, 'a saved listing no longer online is counted, not shown');
  // The alert switch writes through the Alertes tab's own action and puts itself back on failure.
  assert.match(screen, /updateAlertPreferencesAction\(search\.id, \{ frequency: wanted \}\)/);
  assert.match(screen, /setFrequency\(previous\)/);
  assert.match(screen, /const wanted = next \? DEFAULT_ALERT_FREQUENCY : 'off'/);
  assert.match(screen, /const signedIn = Array\.isArray\(accountSearches\)/, 'signed out: no switch, a sign-in prompt');
});

test('results in the app: app cards, the floating bar above the tabs, no tabs on the map', () => {
  const page = read('app/(site)/listings/(search)/(results)/page.js');
  assert.match(page, /appMode=\{app\}/);
  assert.match(page, /<FloatingControlBar hasResults=\{count > 0\} aboveTabBar=\{app\} \/>/);
  const view = read('components/ListingsSplitView.js');
  assert.match(view, /appMode \? \(\s*<AppListingCard key=\{listing\.id\} listing=\{listing\} priority=\{i < 2\} \/>/);
  assert.match(read('components/FloatingControlBar.js'), /aboveTabBar \? 'bottom-\[calc\(5rem\+env\(safe-area-inset-bottom\)\)\]' : 'bottom-6'/);
  assert.match(read('components/AppTabBar.js'), /useSearchParams\(\)\?\.get\('view'\) === 'map'/);
});

test('the app screens share one grey ground and the Saved wording exists in both languages', () => {
  assert.match(read('app/(site)/layout.js'), /min-h-screen bg-canvas-alt/);
  for (const lang of ['fr', 'en']) {
    const saved = JSON.parse(read(`lib/i18n/${lang}.json`)).appShell.saved;
    for (const key of ['title', 'homes', 'searches', 'emptyHomesTitle', 'emptyHomesText', 'browse', 'emptySearchesTitle', 'searchesHint', 'alerts', 'signInForAlerts']) {
      assert.equal(typeof saved[key], 'string', `${lang} ${key}`);
    }
    assert.match(saved.gone.other, /\{count\}/, lang);
  }
});

test('listing in the app: the design bar, with the website\u2019s contact rules and tracking', () => {
  const page = read('app/(site)/listings/[id]/page.js');
  assert.match(page, /\{app \? <AppListingBar listing=\{listing\} \/> : <MobileListingBar listing=\{listing\} \/>\}/);
  const bar = read('components/app/AppListingBar.js');
  assert.match(bar, /resolveWhatsAppRouting\(listing\)/, 'WhatsApp through lib/leadRouting.js, our number first');
  assert.match(bar, /listing\.agent_phone \? \(/, 'tel: only for a verified agent number');
  assert.match(bar, /trackCallClick\(listing\)/);
  assert.match(bar, /trackLeadClick\(listing, routingType, 'listing_app_bar'\)/);
  assert.match(bar, /href=\{`\/listings\/\$\{listing\.id\}\/visite`\}/);
  // The top bar's way back off the tabs.
  assert.match(read('components/app/AppTopBar.js'), /const withBack = hidesAppTabs\(pathname\)/);
});

test('booking in the app: the same calendar and action, answered back on its own screen', () => {
  const action = read('app/(site)/listings/[id]/actions.js');
  assert.match(action, /returnTo === 'app'\s*\?\s*`\/listings\/\$\{propertyId\}\/visite`/);
  const booking = read('components/app/AppVisitBooking.js');
  assert.match(booking, /submitVisitRequestAction\.bind\(null, listing\.id\)/, 'no second way of requesting a visit');
  assert.match(booking, /<input type="hidden" name="return_to" value="app" \/>/);
  assert.match(booking, /<VisitSlotPicker propertyId=\{listing\.id\} name="preferred_slot_at"/);
  assert.match(booking, /hidden=\{step !== 1\}/, 'step 1 stays mounted so the slot is posted');
  assert.match(booking, /t\(sent === 'team' \? 'enquiry\.sentTeam' : 'enquiry\.sent'\)/, 'never says an agent has it when the desk does');
  const page = read('app/(site)/listings/[id]/visite/page.js');
  assert.match(page, /const listing = await getListingById\(id\);\s*if \(!listing\) notFound\(\);/, 'the public gate');
  assert.match(page, /const SENT = new Set\(\['1', 'team'\]\)/);
  for (const lang of ['fr', 'en']) {
    const visit = JSON.parse(read(`lib/i18n/${lang}.json`)).appShell.visit;
    assert.match(visit.step, /\{step\}/, lang);
    assert.match(visit.continueWith, /\{slot\}/, lang);
  }
});

test('filters in the app: the design bottom sheet around the same fields and count', () => {
  const modal = read('components/FilterModal.js');
  // One set of fields for both sheets, so the app never offers different filters.
  assert.match(modal, /const fields = \(/);
  assert.equal((modal.match(/\{fields\}/g) || []).length, 2, 'both sheets render the shared fields');
  assert.match(modal, /if \(app\) \{\s*return \(\s*<AppFilterSheet/);
  // The app sheet (and motion) load only in app mode: the website never downloads them.
  assert.match(modal, /const AppFilterSheet = dynamic\(\(\) => import\('\.\/app\/AppFilterSheet'\), \{ ssr: false \}\)/);
  assert.doesNotMatch(modal, /from 'motion\/react'/);
  // The website keeps its full-height sheet (the h-auto specificity fix).
  assert.match(modal, /data-\[side=bottom\]:h-\[100dvh\]/);
  const sheet = read('components/app/AppFilterSheet.js');
  assert.match(sheet, /dragListener=\{false\}/, 'only the handle starts a drag, the fields scroll');
  assert.match(sheet, /onPointerDown=\{\(event\) => dragControls\.start\(event\)\}/);
  assert.match(sheet, /info\.offset\.y > 110 \|\| info\.velocity\.y > 600/);
  assert.match(sheet, /max-h-\[88dvh\]/);
  assert.match(read('components/FilterBar.js'), /app=\{appMode\}/);
  assert.match(read('app/(site)/listings/(search)/(results)/page.js'), /cities=\{publicCities\}\s*appMode=\{app\}/);
  for (const lang of ['fr', 'en']) assert.equal(typeof JSON.parse(read(`lib/i18n/${lang}.json`)).appShell.filters.reset, 'string');
});

test('agents in the app: five tabs from the server, Compte holds everything else', () => {
  const layout = read('app/compte/agent/layout.js');
  assert.match(layout, /isAppRequest\(\),\s*\]\);/);
  assert.match(layout, /appMode=\{app\}/);
  const sidebar = read('components/AgentSidebar.js');
  assert.match(sidebar, /const tabs = appMode \? APP_TABS : nav\.filter/);
  const tabs = sidebar.slice(sidebar.indexOf('const APP_TABS = ['), sidebar.indexOf('];', sidebar.indexOf('const APP_TABS = [')));
  for (const href of ['/compte/agent', '/compte/agent/biens', '/compte/agent/demandes', '/compte/agent/visites', '/compte/agent/menu']) {
    assert.ok(tabs.includes(`href: '${href}'`), href);
  }
  const menu = read('app/compte/agent/menu/page.js');
  assert.match(menu, /const agentId = await getCurrentAgentId\(\);/, 'the session decides whose account it is');
  assert.match(menu, /<form action=\{agentLogoutAction\}>/);
  assert.match(menu, /VERIFIED_LEVELS\.has\(agent\.verification_level\)/, 'the verified mark only for a level the team granted');
  // Every row links to a page that exists.
  for (const href of [...menu.matchAll(/<Row href="([^"]+)"/g)].map((m) => m[1])) {
    const dir = `app${href}`;
    assert.ok(read.exists(`${dir}/page.js`), `${href} has a page`);
  }
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    for (const key of ['homeShort', 'visitsShort', 'accountShort']) assert.equal(typeof dict.agent.nav[key], 'string', `${lang} ${key}`);
    assert.equal(typeof dict.agent.appMenu.signOut, 'string');
  }
});

test('the listing bar draws WhatsApp green and chat blue (variants through cn, not a string join)', async () => {
  const { cn } = await import('@/lib/utils');
  const bar = read('components/app/AppListingBar.js');
  const base = bar.match(/const ICON_BUTTON =\s*'([^']+)'/)[1];
  assert.match(bar, /className=\{cn\(ICON_BUTTON, 'border-transparent bg-green text-white'\)\}/);
  assert.match(bar, /className=\{cn\(ICON_BUTTON, 'text-blue'\)\}/);
  assert.doesNotMatch(bar, /`\$\{ICON_BUTTON\}/, 'no plain string join left');
  const whatsapp = cn(base, 'border-transparent bg-green text-white').split(' ');
  assert.ok(whatsapp.includes('bg-green') && !whatsapp.includes('bg-surface'), 'the white background is dropped');
  assert.ok(whatsapp.includes('text-white') && !whatsapp.includes('text-ink'));
  const chat = cn(base, 'text-blue').split(' ');
  assert.ok(chat.includes('text-blue') && !chat.includes('text-ink'));
});
