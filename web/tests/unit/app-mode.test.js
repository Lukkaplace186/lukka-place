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
  const hero = read('components/app/AppHomeHero.js');
  assert.match(hero, /liveCount > 0 \?/, 'no count line at 0');
  // The website's own hero picture: the one set on /admin/cms, else the built-in photograph.
  assert.match(appHome, /heroImage=\{heroImage\}/);
  assert.match(hero, /image\?\.imageUrl \? <Picture src=\{image\.imageUrl\} alt=\{image\.alt \|\| ''\} \/> : <Picture src=\{heroSunlit\} alt="" blur \/>/);
  // The entrance moves, never fades: the server HTML must show the search card.
  for (const [file, name] of [[top, 'rise'], [top, 'slide'], [top, 'settle'], [hero, 'rise']]) {
    const block = file.slice(file.indexOf(`const ${name}`), file.indexOf('};', file.indexOf(`const ${name}`)));
    assert.ok(block.length > 20, name);
    assert.doesNotMatch(block, /opacity/, name);
  }
  // The scroll effects are off for a phone set to reduce motion.
  assert.match(hero, /style=\{still \? undefined : \{ y: photoY, scale: photoScale \}\}/);
  // Homes carry the screen: a rail of the newest, then the rest; brass only for a verified agent.
  assert.match(top, /<AppRailCard listing=\{listing\} priority=\{index === 0\} \/>/);
  assert.match(read('components/app/AppVerifiedMark.js'), /if \(!listing\?\.agent_verification_level\) return null;/);
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
  // One family everywhere since 2026-11-12 (owner): the app's display serif and its font file are gone.
  assert.equal(existsSync(path.join(process.cwd(), 'lib/appFont.js')), false);
  assert.doesNotMatch(read('app/globals.css'), /u-app-serif/);
  for (const file of ['components/app/AppWelcome.js', 'components/app/AppVisitBooking.js', 'components/app/AppAvatar.js', 'app/(site)/compte/menu/page.js']) {
    assert.doesNotMatch(read(file), /u-app-serif/, file);
  }
});

test('Saved in the app: the design screen, except a shared selection link', () => {
  const page = read('app/(site)/favoris/page.js');
  assert.match(page, /if \(!shared && \(await isAppRequest\(\)\)\) \{\s*return <AppSavedScreen accountSearches=\{await accountSearches\(\)\} initialTab=\{params\?\.onglet === 'recherches' \? 'searches' : 'homes'\} \/>/);
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

test('the listing bar draws WhatsApp green (variants through cn, not a string join)', async () => {
  const { cn } = await import('@/lib/utils');
  const bar = read('components/app/AppListingBar.js');
  const base = bar.match(/const ICON_BUTTON =\s*'([^']+)'/)[1];
  assert.match(bar, /className=\{cn\(ICON_BUTTON, 'border-transparent bg-green text-white'\)\}/);
  assert.doesNotMatch(bar, /`\$\{ICON_BUTTON\}/, 'no plain string join left');
  const whatsapp = cn(base, 'border-transparent bg-green text-white').split(' ');
  assert.ok(whatsapp.includes('bg-green') && !whatsapp.includes('bg-surface'), 'the white background is dropped');
  assert.ok(whatsapp.includes('text-white') && !whatsapp.includes('text-ink'));
});

test('the listing bar has ONE main action: the visit; WhatsApp second; call and chat behind "…"', () => {
  const bar = read('components/app/AppListingBar.js');
  // The visit is the only wide (flex-1) control, and it always shows its full label.
  assert.equal((bar.match(/flex-1/g) || []).length, 1);
  assert.match(bar, /<span className="truncate">\{visitLabel\}<\/span>/);
  assert.doesNotMatch(bar, /visitShort/);
  // Call and chat live inside the menu, which is drawn only when it holds something.
  const menu = bar.slice(bar.indexOf('<DropdownMenuContent'), bar.indexOf('</DropdownMenuContent>'));
  assert.match(menu, /telHref\(listing\.agent_phone\)/);
  assert.match(menu, /chatStartHref\(\{ propertyId: listing\.id \}\)/);
  assert.match(bar, /const hasMore = Boolean\(listing\.agent_phone\) \|\| canMessage;/);
  assert.match(bar, /\{hasMore \? \(/);
  // Order in the bar: menu, WhatsApp, then the visit under the right thumb.
  assert.ok(bar.indexOf('<DropdownMenu>') < bar.indexOf('aria-label={t(\'common.shared.whatsapp\')}'));
  assert.ok(bar.indexOf('aria-label={t(\'common.shared.whatsapp\')}') < bar.indexOf('/visite`}'));
});

test('the /app-demo board is local only: a production build answers 404', () => {
  const page = read('app/app-demo/page.js');
  assert.match(page, /if \(process\.env\.NODE_ENV === 'production'\) notFound\(\);/);
  assert.ok(page.indexOf("process.env.NODE_ENV === 'production'") < page.indexOf('cachedFeaturedListings()'), 'refused before any data is read');
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test('the app avatar: a real photo or the person\u2019s initials, never a stock face', async () => {
  const { initialsOf, avatarSrc } = await import('@/lib/avatar');
  assert.equal(initialsOf('Amara Okafor'), 'AO');
  assert.equal(initialsOf('Pharaon'), 'P');
  assert.equal(initialsOf('Jean Pierre Mbala'), 'JM');
  assert.equal(initialsOf('243812345678'), null, 'a username that is phone digits gives no initials');
  assert.equal(initialsOf(''), null);
  assert.equal(avatarSrc('https://xyz.supabase.co/storage/v1/object/public/avatars/a.png'), 'https://xyz.supabase.co/storage/v1/object/public/avatars/a.png');
  assert.equal(avatarSrc('avatar.png'), null, 'a bare filename is not tried');
  assert.equal(avatarSrc(null), null);
  const customer = read('app/(site)/compte/menu/page.js');
  const agent = read('app/compte/agent/menu/page.js');
  assert.match(customer, /<AppAvatar name=\{name\} size="lg" \/>/);
  assert.match(agent, /<AppAvatar name=\{name \|\| agency\} src=\{agent\.image\} size="lg" verified=\{verified\}/);
  for (const src of [customer, agent, read('components/app/AppAvatar.js'), read('components/ui/avatar.jsx')]) {
    assert.doesNotMatch(src, /unsplash|pravatar|randomuser/i);
  }
});

test('the UI kit (shadcn API, Lukka Place style): motion only where something moves, and the safeguards hold', () => {
  const ui = (name) => read(`components/ui/${name}.jsx`);
  const kit = ['accordion', 'alert', 'attachment', 'avatar', 'badge', 'breadcrumb', 'bubble', 'button-group', 'calendar', 'carousel', 'chart', 'date-picker', 'marker', 'message', 'message-scroller', 'skeleton', 'spinner'];
  for (const name of kit) {
    const src = ui(name);
    assert.doesNotMatch(src, /unsplash|pravatar|randomuser/i, `${name}: no stock imagery`);
    if (/from "motion\/react"/.test(src)) assert.match(src, /^"use client"/, `${name}: motion needs a client component`);
  }
  // No extra packages: carousel, calendar and chart are built on motion.
  for (const name of ['carousel', 'calendar', 'chart', 'date-picker']) assert.doesNotMatch(ui(name), /from "(embla-carousel-react|react-day-picker|recharts|date-fns)"/, `${name}: no extra package`);
  assert.match(ui('message-scroller'), /role="log"/);
  assert.match(ui('message-scroller'), /aria-relevant="additions"/);
  assert.match(ui('calendar'), /const present = useIsPresent\(\)/, 'the month sliding out cannot be tapped');
  assert.match(ui('carousel'), /useReducedMotion\(\)/);
  assert.match(ui('chart'), /<span className="u-tabular text-right font-semibold text-ink">\{d\.display \?\? d\.value\}<\/span>/, 'numbers are text, the bar is only a picture');
  assert.match(ui('date-picker'), /value=\{value \? localDayKey\(value\) : ""\}/, 'the local day, not toISOString');
  assert.doesNotMatch(ui('date-picker'), /toISOString\(\)\.slice/);
  assert.match(ui('bubble'), /initial=\{appear \?/, 'only a message that just arrived animates');
  assert.match(ui('badge'), /secondary: "border-transparent bg-canvas-deep/, 'visible on the app\u2019s grey screens');
  // The showcase never puts invented words in a real agency's mouth.
  assert.doesNotMatch(read('app/app-demo/ComponentsShowcase.js'), /Pharaon/);
});

test('the UI kit in the app screens: badges, booking alert and spinner, saved skeleton, FAQ, where to look', () => {
  assert.match(read('components/app/AppListingCard.js'), /<AppCardBadges listing=\{listing\} \/>/);
  const badges = read('components/app/AppCardBadges.js');
  assert.match(badges, /cardPromoBadge\(listing\)/, 'the same facts as the website (a recorded cut, "Nouveau")');
  const booking = read('components/app/AppVisitBooking.js');
  assert.match(booking, /<Alert variant="destructive"/);
  assert.match(booking, /const \{ pending \} = useFormStatus\(\)/);
  assert.match(booking, /disabled=\{disabled \|\| pending\}/, 'no second request while the first is on its way');
  const saved = read('components/app/AppSavedScreen.js');
  assert.match(saved, /<Skeleton className="h-\[6\.5rem\] w-28 rounded-none" \/>/);
  assert.match(saved, /<Alert variant="destructive" className="py-2\.5">/);
  const menu = read('app/(site)/compte/menu/page.js');
  assert.match(menu, /const FAQ = \['visit', 'whatsapp', 'costs', 'alerts'\];/);
  assert.match(menu, /<Accordion type="single" collapsible/);
  const home = read('components/AppHomeTop.js');
  assert.match(home, /href: localizeHref\(`\/listings\?commune=\$\{encodeURIComponent\(c\.commune\)\}`, locale\)/);
  assert.match(home, /communes\.length >= 3 \?/, 'no chart for one or two communes');
  for (const lang of ['fr', 'en']) {
    const app = JSON.parse(read(`lib/i18n/${lang}.json`)).appShell;
    for (const key of ['visit', 'whatsapp', 'costs', 'alerts']) {
      assert.equal(typeof app.faq.items[key].q, 'string', `${lang} faq ${key}`);
      assert.equal(typeof app.faq.items[key].a, 'string', `${lang} faq ${key}`);
    }
    assert.equal(typeof app.home.whereTitle, 'string');
    assert.equal(typeof app.visit.sending, 'string');
  }
  // The FAQ answers promise nothing the app does not do (no refunded deposit, no fixed amounts).
  assert.doesNotMatch(JSON.parse(read('lib/i18n/fr.json')).appShell.faq.items.costs.a, /rembours|restitu|\d+ mois/);
});

test('Messagerie in the app: same chat logic, drawn with the app components, website untouched', async () => {
  const { groupChatRows } = await import('@/lib/chatGroups');
  const msg = (id, senderRole, extra = {}) => ({ message: { id, senderRole, kind: 'text', body: String(id), ...extra }, divider: extra.divider || null });
  const rows = [
    { ...msg(1, 'customer'), divider: 'Hier' },
    msg(2, 'customer'),
    msg(3, 'agent'),
    { message: { id: 4, kind: 'system', body: 'Bien retiré' }, divider: null },
    msg(5, 'agent'),
    { ...msg(6, 'agent'), divider: 'Aujourd’hui' },
  ];
  const groups = groupChatRows(rows, 'customer');
  assert.deepEqual(groups.map((g) => (g.type === 'group' ? `${g.mine ? 'me' : 'them'}:${g.rows.length}` : `${g.type}:${g.label}`)), [
    'divider:Hier', 'me:2', 'them:1', 'system:Bien retiré', 'them:1', 'divider:Aujourd’hui', 'them:1',
  ], 'a system line or a new day ends a group');

  const thread = read('components/chat/ChatThread.js');
  // The app look loads on its own: the website's chat never ships motion.
  assert.match(thread, /const AppChatList = dynamic\(\(\) => import\('\.\/AppChatList'\)\);/);
  assert.doesNotMatch(thread, /from 'motion\/react'/);
  assert.match(thread, /\{appMode \? \(\s*<AppChatList/);
  assert.match(thread, /const isNew = useCallback\(\(message\) => !initialIdsRef\.current\.has\(message\.id\), \[\]\);/, 'only messages arriving while open animate');
  assert.match(thread, /onRetry=\{deliver\}/, 'Réessayer resends through the same path');
  assert.match(read('app/(site)/messages/[id]/page.js'), /appMode=\{await isAppRequest\(\)\}/);
  assert.match(read('app/compte/agent/messages/[id]/page.js'), /appMode=\{await isAppRequest\(\)\}/);
  assert.match(read('app/compte/agent/layout.js'), /\{app \? <AppMotion>\{children\}<\/AppMotion> : children\}/);
  assert.equal(hidesAppTabs('/messages/42'), true, 'the reply field holds the bottom edge');
  assert.equal(hidesAppTabs('/messages'), false);
  assert.doesNotMatch(read('components/chat/AppChatList.js'), /écrit…|typing/i, 'no typing indicator the chat cannot know about');
});

test('app results list: the search row is the top bar, photos swipe, sort sits on the count line', () => {
  // The filter bar takes the top bar's place on a phone, list view only, and tucks away on scroll down.
  const page = read('app/(site)/listings/(search)/(results)/page.js');
  assert.match(page, /className=\{isMapView \? 'hidden lg:block' : app \? 'max-lg:contents' : ''\}/, 'a sticky box cannot leave its parent');
  assert.match(page, /data-app-results=\{app && !isMapView \? '' : undefined\}/, 'the map view keeps the top bar');
  assert.match(read('app/globals.css'), /body:has\(\[data-app-results\]\) \[data-app-top-bar\],\s*body:has\(\[data-app-listing\]\) \[data-app-top-bar\] \{\s*display: none;/);
  assert.match(read('components/app/AppTopBar.js'), /data-app-top-bar=""/);
  const bar = read('components/FilterBar.js');
  assert.match(bar, /appMode && 'max-lg:top-0 max-lg:z-\[60\] max-lg:-mt-16 /);
  assert.match(bar, /if \(!phone \|\| typing \|\| y < 160\) setTucked\(false\);/, 'never while typing, never near the top');
  assert.match(bar, /transform: appMode && tucked \? 'translate3d\(0, -110%, 0\)' : 'translateZ\(0\)'/);
  // The card: the listing's own photos, swiped; a real agency name or no line.
  const card = read('components/app/AppListingCard.js');
  assert.match(card, /<CardImageCarousel\s+images=\{images\}/);
  assert.match(card, /\{photo \+ 1\}\/\{images\.length\}/);
  assert.match(card, /const agency = displayableAgencyName\(listing\.agency_name\);/);
  assert.doesNotMatch(card.slice(card.indexOf('<m.article'), card.indexOf('className=', card.indexOf('<m.article'))), /opacity/);
  // Sort: one sheet, opened from the count line in the app and from the pill on the website.
  assert.match(read('components/ResultsHeader.js'), /\{appMode \? \(\s*<span className="-my-3 shrink-0 lg:hidden">\s*<Suspense fallback=\{null\}>\s*<AppSortButton \/>/);
  const floating = read('components/FloatingControlBar.js');
  assert.match(floating, /<SortSheet open=\{sortOpen\} onOpenChange=\{setSortOpen\} \/>/);
  assert.match(floating, /<SaveSearchButton variant="pill" tone="solid" \/>/, 'the app: two solid buttons, Carte and Alerte');
  // "Nouveau" no longer wears the action colour.
  assert.match(read('components/app/AppCardBadges.js'), /<Badge variant="outline" className="border-transparent shadow-sm">\s*<Sparkles/);
});

test('app listing page: photo to the top, one agent row, price in the bar, similar homes as a rail', () => {
  const page = read('app/(site)/listings/[id]/page.js');
  assert.match(page, /\{app \? <AppListingHeader listing=\{listing\} where=\{where\} \/> : null\}/);
  assert.match(page, /\$\{app \? ' max-sm:-mt-16' : ''\}/, 'the photo runs under the clear bar on a phone');
  // The bottom bar already carries the contact buttons: the app shows the agent once, and no second price panel.
  const mobile = page.slice(page.indexOf('{app ? (\r\n              <div className="lg:hidden">\r\n                <AppAgentRow'), page.indexOf('<div id="caracteristiques"'));
  assert.match(mobile, /<AppAgentRow listing=\{listing\} \/>/);
  assert.match(page, /const name = displayableAgencyName\(listing\.agency_name\);/, 'never a phone-shaped name');
  assert.match(page, /if \(app\) \{[\s\S]*?return <AppRelatedRail title=\{title\} lead=\{lead\} listings=\{related\} \/>;/);
  const header = read('components/app/AppListingHeader.js');
  assert.match(header, /data-app-listing=""/);
  assert.match(header, /<Price amount=\{listing\.price\} purpose=\{listing\.purpose\} pricePeriod=\{listing\.price_period\} \/>/);
  // The website's royal price panel: the period is readable on the blue.
  assert.match(read('components/PricePanel.js'), /periodClassName="[^"]*text-white\/80"/);
});

test('app photo hand-off: a tapped card leaves its photo for the listing loading screen', async () => {
  const { listingIdOfSegment, listingPhotoTransitionName, recallListingPhoto, rememberListingPhoto } = await import('@/lib/appPhotoHandoff');
  assert.equal(listingIdOfSegment('885-appartement-1-chambre-a-louer-kasa-vubu'), '885');
  assert.equal(listingIdOfSegment('abc'), null);
  assert.equal(listingPhotoTransitionName(885), 'listing-photo-885');
  const img = (left, src) => ({ currentSrc: src, getBoundingClientRect: () => ({ left, right: left + 300 }) });
  const box = { getBoundingClientRect: () => ({ left: 0, width: 300 }), querySelectorAll: () => [img(-300, 'first.webp'), img(0, 'second.webp')] };
  rememberListingPhoto(885, box, 1000);
  assert.equal(recallListingPhoto('885', 2000), 'second.webp', 'the photo on screen, not the first of the strip');
  assert.equal(recallListingPhoto(886, 2000), null, 'another listing gets nothing');
  assert.equal(recallListingPhoto(885, 1000 + 16000), null, 'stale after 15 s');
  rememberListingPhoto(885, null, 1000);
  assert.equal(recallListingPhoto(885, 1500), null);
  for (const file of ['components/app/AppListingCard.js', 'components/app/AppRailCard.js']) {
    assert.match(read(file), /<ViewTransition name=\{listingPhotoTransitionName\(listing\.id\)\} share="morph" default="none">/, file);
  }
  assert.match(read('app/(site)/listings/[id]/page.js'), /transitionName=\{app \? listingPhotoTransitionName\(listing\.id\) : null\}/, 'the website gets no transition name');
});

test('app pull to refresh: list screens only, a clear downward pull only', async () => {
  const { PULL_MAX, PULL_THRESHOLD, pullDecision, pullsToRefresh } = await import('@/lib/appPullRules');
  for (const path of ['/', '/listings', '/favoris', '/messages', '/compte/client/visites']) assert.equal(pullsToRefresh(path), true, path);
  for (const path of ['/listings/885-appartement', '/listings/885-x/visite', '/messages/12', '/compte/agent', '/bienvenue', null]) assert.equal(pullsToRefresh(path), false, String(path));
  assert.equal(pullDecision({ dy: 100, scrollY: 0 }), 50);
  assert.equal(pullDecision({ dy: 1000, scrollY: 0 }), PULL_MAX);
  assert.ok(pullDecision({ dy: 160, scrollY: 0 }) >= PULL_THRESHOLD);
  assert.equal(pullDecision({ dy: 100, scrollY: 4 }), null, 'the page has scrolled: not a pull');
  assert.equal(pullDecision({ dx: 90, dy: 60, scrollY: 0 }), null, 'a sideways swipe is the photo strip\'s');
  assert.equal(pullDecision({ dy: -20, scrollY: 0 }), null);
  const layout = read('app/(site)/layout.js');
  assert.match(layout, /\{app \? <AppPullToRefresh \/> : null\}/);
  assert.match(read('components/app/AppPullToRefresh.js'), /addEventListener\('touchmove', onMove, \{ passive: true \}\)/, 'never blocks a scroll');
});

test('app loading screens and the rest of the pass: own shapes, one place line, tidy filters', () => {
  assert.match(read('app/(site)/_shared/SiteLoading.js'), /if \(await isAppRequest\(\)\) return <AppListSkeleton /);
  assert.match(read('app/(site)/listings/[id]/loading.js'), /if \(await isAppRequest\(\)\) return <AppListingSkeleton /);
  // "Quartier, commune": the city only outside Kinshasa (lib/placeLabel.js), on every app card.
  for (const file of ['AppListingCard', 'AppRailCard', 'AppSavedRow', 'AppVisitBooking']) {
    const src = read(`components/app/${file}.js`);
    assert.match(src, /const where = locationLine\(listing\);/, file);
    assert.doesNotMatch(src, /feedLocationLine/, file);
  }
  assert.match(read('components/FilterModal.js'), /const oneRow = app \? '[^']*overflow-x-auto[^']*' : 'flex flex-wrap gap-2';/);
  assert.match(read('components/app/AppVisitBooking.js'), /if \(sent\) navigator\.vibrate\?\.\(18\);/);
  assert.match(read('DESIGN.md'), /### In the store app/);
});
