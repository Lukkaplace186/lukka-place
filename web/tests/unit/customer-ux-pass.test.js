// UX pass for customers (2026-11-12): one main button on a listing, sign in
// with WhatsApp, an account only when needed, back keeps your place, and the
// app's first-open questions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { safeSignInNext, cleanFullName, isNewAccount } from '@/lib/whatsappSignInRules';
import { GUEST_FAVORITE_LIMIT, guestFavoriteDecision } from '@/lib/guestSaveRules';
import {
  appStartTarget, budgetChoices, formatWelcomeBudget, toggleCommune, welcomeSearchQuery, MAX_WELCOME_COMMUNES,
} from '@/lib/welcomeRules';
import { hidesAppTabs, isWelcomePath } from '@/lib/appModeRules';
import { SIGNUP_ENTRIES, entryForPromptTrigger } from '@/lib/signupFunnelRules';
import { parseListingsSearchParams } from '@/lib/searchQuery';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

// --- sign in with WhatsApp -----------------------------------------------------

test('WhatsApp sign-in: only same-site paths, real names, and "new" means the last hour', () => {
  assert.equal(safeSignInNext('/compte/client/visites'), '/compte/client/visites');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', '', null]) assert.equal(safeSignInNext(bad), '/compte/client');
  assert.equal(cleanFullName('  Marie   Nsumbu '), 'Marie Nsumbu');
  assert.equal(cleanFullName('7'), null);
  assert.equal(cleanFullName('12345'), null, 'a number is not a name');
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(isNewAccount('2026-11-12T11:30:00Z', now), true);
  assert.equal(isNewAccount('2026-11-12T10:30:00Z', now), false);
  assert.equal(isNewAccount(null, now), false);
});

test('WhatsApp sign-in: the account comes from the signed attempt cookie and the proof from the sender', () => {
  const actions = read('app/(site)/compte/connexion/whatsappActions.js');
  assert.match(actions, /^'use server';/);
  // Start: the account is found (or opened) for the typed number, then the attempt cookie names it.
  assert.match(actions, /await setVerifyAttemptCookie\(\{ role: 'customer', id: Number\(customer\.id\), phone \}\)/);
  assert.match(actions, /createCustomer\(\{ phone, passwordHash: null, fullName \}\)/);
  assert.match(actions, /rateLimited\(`wa-signin:\$\{key\}`/);
  // Check: never an id from the caller — the cookie, then the engine's match on that number.
  const check = actions.slice(actions.indexOf('export async function checkWhatsAppSignInAction'));
  assert.match(check, /const attempt = await getVerifyAttempt\(\);/);
  assert.match(check, /if \(!\(await consumeVerifiedChallenge\(attempt\)\)\) return \{ status: 'pending' \};/);
  assert.ok(check.indexOf('consumeVerifiedChallenge') < check.indexOf('establishCustomerSession'), 'no session before the proof');
  assert.match(check, /mergeAnonymousData\(attempt\.id, \{ favoriteIds, savedSearches \}\)/);
  // The code screen is public (no session yet) and uses this check.
  assert.match(read('middleware.js'), /'\/compte\/connexion\/whatsapp',/);
  assert.match(read('app/(site)/compte/connexion/whatsapp/page.js'), /checkAction=\{checkWhatsAppSignInAction\}/);
  // The login page leads with WhatsApp; the password form follows and does not steal focus.
  const login = read('app/(site)/compte/connexion/page.js');
  assert.ok(login.indexOf('<WhatsAppSignInForm') < login.indexOf('<LoginForm'));
  assert.match(login, /autoFocus=\{false\}/);
});

// --- an account only when needed ----------------------------------------------

test('a guest keeps a few homes on the device; the save that reaches the limit asks, past it the heart asks first', () => {
  assert.equal(GUEST_FAVORITE_LIMIT, 3);
  assert.equal(guestFavoriteDecision(0, false), 'save');
  assert.equal(guestFavoriteDecision(1, false), 'save');
  assert.equal(guestFavoriteDecision(2, false), 'save-and-ask');
  assert.equal(guestFavoriteDecision(3, false), 'ask');
  assert.equal(guestFavoriteDecision(5, true), 'unsave', 'removing is always allowed');
  const button = read('components/FavoriteButton.js');
  assert.match(button, /guestFavoriteDecision\(getLocalFavoriteIds\(\)\.length, favorited\)/);
  assert.equal(entryForPromptTrigger('favoriteKeep'), 'favorite');
});

test('the prompt says why, then signs in with WhatsApp; a visit asks only after it is sent', () => {
  const modal = read('components/AuthPromptModal.js');
  assert.match(modal, /REASON_KEYS\[trigger\]/);
  for (const dict of [fr, en]) {
    for (const key of ['save', 'alert', 'favorite']) assert.ok(dict.listings.authPrompt.reasons[key], key);
    assert.ok(dict.listings.authPrompt.favoriteKeep);
  }
  const booking = read('components/app/AppVisitBooking.js');
  assert.match(booking, /loggedIn \? null : <p className="text-\[0\.9375rem\] text-ink-70">\{t\('appShell\.visit\.followGuest'\)\}<\/p>/);
  assert.match(booking, /entree=visit/);
  for (const entry of ['whatsapp', 'visit', 'onboarding']) {
    assert.ok(SIGNUP_ENTRIES.includes(entry), entry);
    assert.ok(fr.admin.growth.signup.entries[entry] && en.admin.growth.signup.entries[entry], `${entry} label`);
  }
});

// --- back keeps your place ----------------------------------------------------

test('back closes the filter sheet and the photo viewer, never the page; iPhone gets the edge swipe', () => {
  const hook = read('lib/useBackToClose.js');
  assert.match(hook, /window\.history\.pushState\(\{ \.\.\.\(window\.history\.state \|\| \{\}\), __lkpOverlay: marker \}, ''\)/);
  assert.match(hook, /if \(!poppedByBack && !released\.current && window\.history\.state\?\.__lkpOverlay === marker\) window\.history\.back\(\);/);
  const sheet = read('components/app/AppFilterSheet.js');
  assert.match(sheet, /const releaseBack = useBackToClose\(open, onClose\);/);
  assert.match(sheet, /releaseBack\(\);\s*applyFilters\?\.\(\);/, 'applying navigates: its entry is released, not taken back');
  const gallery = read('components/PhotoGallery.js');
  assert.match(gallery, /useBackToClose\(isOpen, closeLightbox\);/);
  assert.match(gallery, /releaseGridBack\(\);\s*setGridOpen\(false\);\s*setLightboxIndex\(index\);/);
  const ios = read('../mobile/ios/App/App/SceneDelegate.swift');
  assert.match(ios, /webView\?\.allowsBackForwardNavigationGestures = true/);
  assert.match(ios, /window\?\.rootViewController = LukkaBridgeViewController\(\)/);
});

// --- one main button on a listing ---------------------------------------------

test('the listing bar labels the menu in both languages', () => {
  assert.ok(fr.appShell.listingBar.more && en.appShell.listingBar.more);
});

// --- first-open questions -----------------------------------------------------

test('the welcome answers become an ordinary /listings search the results page reads', () => {
  const query = welcomeSearchQuery({ purpose: 'louer', budget: 800, communes: ['Limete', 'Ngaliema'] });
  const parsed = parseListingsSearchParams(new URLSearchParams(query));
  assert.equal(parsed.transactionType, 'location');
  assert.equal(parsed.priceMax, '800');
  assert.equal(parsed.commune, 'Limete');
  assert.deepEqual(parsed.communes, ['Limete', 'Ngaliema']);
  assert.equal(welcomeSearchQuery({ purpose: 'acheter', budget: null }), 'transaction_type=vente');
  assert.equal(welcomeSearchQuery({ purpose: 'courte', budget: 300 }), 'transaction_type=location&lease_term=short', 'no budget on short stays');
  assert.equal(welcomeSearchQuery({ purpose: 'louer', communes: ['Gombe'] }), 'transaction_type=location&commune=Gombe');
  assert.deepEqual(budgetChoices('courte'), []);
  assert.equal(budgetChoices('louer').at(-1), null, '"Peu importe" last');
  assert.equal(formatWelcomeBudget(1500), '1 500 $');
  let picked = [];
  for (const c of ['A', 'B', 'C', 'D']) picked = toggleCommune(picked, c);
  assert.deepEqual(picked, ['A', 'B', 'C'].slice(0, MAX_WELCOME_COMMUNES));
  assert.deepEqual(toggleCommune(picked, 'B'), ['A', 'C']);
});

test('the app opens on the questions until answered or skipped; agents never see them', () => {
  assert.equal(appStartTarget({ isAgent: false, welcomed: false }), '/bienvenue');
  assert.equal(appStartTarget({ isAgent: false, welcomed: true }), '/');
  assert.equal(appStartTarget({ isAgent: true, welcomed: false }), '/compte/agent');
  assert.equal(isWelcomePath('/bienvenue'), true);
  assert.equal(hidesAppTabs('/bienvenue'), true, 'no tabs under the questions');
  assert.match(read('components/app/AppTopBar.js'), /const withBack = hidesAppTabs\(pathname\) && !isWelcomePath\(pathname\);/);
  const screen = read('components/app/AppWelcome.js');
  assert.match(screen, /saveSearch\(\{ query, label: buildSearchLabel\(new URLSearchParams\(query\), t\), href \}\)/);
  assert.match(screen, /trigger="alert"/, 'alerts are offered after the questions, with the account prompt');
  assert.match(read('app/(site)/bienvenue/page.js'), /cachedPopularCommunes\(8\)/, 'communes from the database, never a list');
  for (const dict of [fr, en]) {
    const w = dict.appShell.welcome;
    for (const key of ['title', 'skip', 'purposeQuestion', 'budgetQuestionRent', 'budgetQuestionBuy', 'communesQuestion', 'alertTitle', 'alertYes', 'alertLater']) assert.ok(w[key], key);
    assert.match(w.upTo, /\{amount\}/);
    assert.match(w.communesHint, /\{max\}/);
  }
});
