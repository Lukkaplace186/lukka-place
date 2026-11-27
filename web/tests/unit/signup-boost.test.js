import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { accountRequested, accountStatusParam, guestAccountPlan, proveAccountHref } from '@/lib/guestAccountRules';
import { FEED_ALERT_AFTER, feedAlertIndex, feedAlertOffersCommunes, feedAlertQuery, feedAlertReady, isNotACriterion } from '@/lib/feedAlertRules';
import { similarAlertNext } from '@/lib/contactSignupPrompt';
import { nudgeNext, shouldNudge, VIEWED_THRESHOLD } from '@/lib/signupNudgeRules';
import { NO_PASSWORD_HASH, storedPasswordHash } from '@/lib/whatsappSignInRules';
import { PROMPT_ENTRIES, SIGNUP_ENTRIES } from '@/lib/signupFunnelRules';

/*
 * Customer sign-up push (2026-11-24, owner: "as easy as possible for
 * customers to sign up"). Baseline: 20,075 visitors in 14 days, ~25 accounts.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const fr = JSON.parse(read('lib/i18n/fr.json'));
const en = JSON.parse(read('lib/i18n/en.json'));

// --- forms that already ask for a name and a number open the account ---------

test('the account box: ticked by default, an explicit untick says no', () => {
  assert.equal(accountRequested(['0', '1']), true, 'hidden 0 then the ticked box');
  assert.equal(accountRequested(['0']), false, 'unticked: only the hidden 0');
  assert.equal(accountRequested([]), true, 'a form cached before the box');
  assert.equal(accountRequested(undefined), true);
});

test('who gets an account from a form, before any database read', () => {
  assert.deepEqual(guestAccountPlan({ phone: '243812345678', name: 'Marie Nsumbu', requested: true, signedIn: false }), { action: 'lookup', fullName: 'Marie Nsumbu' });
  assert.equal(guestAccountPlan({ phone: '243812345678', name: '', requested: true, signedIn: false }).fullName, null, 'no name: an existing account can still sign in');
  assert.equal(guestAccountPlan({ phone: '243812345678', name: 'Marie', requested: false, signedIn: false }).reason, 'declined');
  assert.equal(guestAccountPlan({ phone: '243812345678', name: 'Marie', requested: true, signedIn: true }).reason, 'signed_in');
  assert.equal(guestAccountPlan({ phone: '243000012345', name: 'Démo', requested: true, signedIn: false }).reason, 'demo', 'demo numbers never become real accounts');
  assert.equal(guestAccountPlan({ phone: null, name: 'Marie', requested: true, signedIn: false }).reason, 'no_phone');
});

test('the confirmation links to the WhatsApp code screen, never a password', () => {
  assert.equal(proveAccountHref('created', '/compte/client'), '/compte/connexion/whatsapp?next=%2Fcompte%2Fclient&nouveau=1');
  assert.equal(proveAccountHref('existing', '/compte/client/visites'), '/compte/connexion/whatsapp?next=%2Fcompte%2Fclient%2Fvisites&compte=existant');
  assert.equal(accountStatusParam('created'), 'created');
  assert.equal(accountStatusParam('skipped'), null);
});

test('an account opened without a password stores the marker, never NULL (password_hash is NOT NULL)', () => {
  assert.equal(storedPasswordHash(null), NO_PASSWORD_HASH);
  assert.equal(storedPasswordHash('salt:hash'), 'salt:hash');
  assert.match(read('lib/customers.js'), /\[phone, storedPasswordHash\(passwordHash\), fullName \|\| null\]/);
});

test('the account step runs after the lead or the visit, never instead of it, and never throws', () => {
  const guest = read('app/(site)/trouver-pour-moi/actions.js');
  assert.ok(guest.indexOf('openGuestAccount(') > guest.indexOf('await createLead('), 'after the lead');
  assert.match(guest, /accountRequested\(formData\.getAll\(OPEN_ACCOUNT_FIELD\)\)/);
  const visit = read('app/(site)/listings/[id]/actions.js');
  assert.ok(visit.indexOf('openGuestAccount(') > visit.indexOf('await createViewingRequest('), 'after the visit');
  assert.match(visit, /entry: 'visit'/);
  const helper = read('lib/guestAccount.js');
  assert.match(helper, /catch \(err\) \{\n\s+console\.error\(`\[guest-account\]/);
  // 2026-11-24: a NEW number is signed in at once; a known one gets the code screen.
  const created = helper.slice(helper.indexOf('customer = await createCustomer('));
  assert.match(created, /await signInNewCustomer\(customer, \{ phone, localData, source:/);
  const known = helper.slice(helper.indexOf('let customer = await getCustomerByPhone(phone);'), helper.indexOf('customer = await createCustomer('));
  assert.match(known, /setVerifyAttemptCookie/, 'a known number proves itself');
  assert.doesNotMatch(known, /signInNewCustomer|establishCustomerSession/, 'never signed in on a typed number alone');
  for (const file of ['app/(site)/trouver-pour-moi/actions.js', 'app/(site)/listings/[id]/actions.js']) {
    assert.match(read(file), /localData: localSavesFromForm\(formData\)/, file);
  }
  // Both forms carry the box, hidden when signed in.
  for (const file of ['components/GuestRequestForm.js', 'components/VisitRequestDialog.js']) {
    const src = read(file);
    assert.match(src, /name=\{OPEN_ACCOUNT_FIELD\} value="0"/, file);
    assert.match(src, /name=\{OPEN_ACCOUNT_FIELD\} value="1" defaultChecked/, file);
    assert.match(src, /loggedIn \? null :/, file);
  }
  assert.match(read('components/EnquiryCard.js'), /<AccountOfferCard status=\{visitAccount\} entry="visit"/);
  assert.match(read('components/GuestRequestForm.js'), /<AccountOfferCard status=\{state\.account\} entry="request"/);
});

// --- a new number + a name = signed in, no WhatsApp step (2026-11-24) ---------

test('"Continuer avec WhatsApp": a new number is signed in at once, a known one sends the code', () => {
  const src = read('app/(site)/compte/connexion/whatsappActions.js');
  const start = src.slice(src.indexOf('export async function startWhatsAppSignInAction'), src.indexOf('export async function checkWhatsAppSignInAction'));
  const newBranch = start.slice(start.indexOf('if (created) {'), start.indexOf('// A number that already has an account'));
  assert.match(newBranch, /await signInNewCustomer\(customer, \{ phone, localData: localSavesFromForm\(formData\), source: `wa-signin:\$\{entry\}` \}\);\n\s+redirect\(next\);/);
  assert.match(newBranch, /recordSignupOutcome\(\{ step: 'created', entry, customerId: Number\(customer\.id\) \}\)/);
  const knownBranch = start.slice(start.indexOf('// A number that already has an account'));
  assert.match(knownBranch, /setVerifyAttemptCookie[\s\S]*redirect\(codeScreenHref\(next, await sendSignInCode\(customer\)\)\);/);
  assert.match(read('app/(site)/compte/connexion/WhatsAppSignInForm.js'), /<LocalSavesFields \/>/);
});

test('a number signed in without proof is not marked confirmed (money still waits for a proof)', () => {
  const helper = read('lib/newCustomerSession.js');
  assert.match(helper, /establishCustomerSession\(\{ id, tokenVersion: customer\.token_version \?\? 0 \}\)/);
  assert.doesNotMatch(helper, /consumeCustomerOtp|phone_verified_at\s*=/);
  assert.match(helper, /CompleteRegistration/);
  assert.match(read('lib/referralCredits.js'), /phone_verified_at/, 'partner credits keep counting confirmed numbers only');
});

test('the saved homes of this phone ride along with the form', () => {
  const src = read('components/LocalSavesFields.js');
  assert.match(src, /name="favoriteIds"/);
  assert.match(src, /name="savedSearches"/);
  assert.match(src, /form\.addEventListener\('submit', fill\)/);
  for (const file of ['components/GuestRequestForm.js', 'components/VisitRequestDialog.js']) {
    assert.match(read(file), /<LocalSavesFields \/>/, file);
  }
});

test('after a request or a visit, a new account is already open: the card leads to the account, not WhatsApp', () => {
  const card = read('components/AccountOfferCard.js');
  assert.match(card, /if \(signedIn\) href = next;/);
  assert.match(card, /if \(shown && status !== 'created'\) trackCustomerSignup\('prompt_shown', entry\)/);
  // No new-account copy still promises a code from WhatsApp.
  const newAccountCopy = [
    'auth.whatsappSignIn.lead', 'listings.accountOffer.created.body', 'listings.accountOffer.offer.body',
    'listings.contactSignup.lead', 'listings.feedAlert.footnote', 'listings.alertLanding.perkNoPassword',
  ];
  const get = (dict, key) => key.split('.').reduce((o, k) => o[k], dict);
  for (const key of newAccountCopy) {
    assert.doesNotMatch(get(fr, key), /\bun code\b/i, `fr ${key}`);
    assert.doesNotMatch(get(en, key), /\ba code\b/i, `en ${key}`);
  }
});

// --- a known number: a code we send, typed on the site (2026-11-24) ----------

test('a known number gets a code on WhatsApp and types it; the "send us a code" way waits underneath', () => {
  const page = read('app/(site)/compte/connexion/whatsapp/page.js');
  assert.match(page, /const codeMode = signInCodeEnabled\(\);/);
  assert.match(page, /<SignInCodeForm/);
  assert.match(page, /<form action=\{sendSignInCodeAction\}/, '"Recevoir mon code" / "Renvoyer le code"');
  assert.match(page, /<CodeFallback\s+label=\{t\('auth\.whatsappSignIn\.noCodeFallback'\)\}\s+lateLabel=\{codeWaiting \? t\('auth\.whatsappSignIn\.codeLate'\) : null\}\s+defaultOpen=\{Boolean\(sendError\)\}\s+>\s+\{reversePanel\}/);
  assert.match(page, /\{!codeMode \? reversePanel :/, 'no template: the older way is the screen');
  const form = read('components/SignInCodeForm.js');
  assert.match(form, /autoComplete="one-time-code"/);
  assert.match(form, /if \(digits\.length === 6 && !pending\) formRef\.current\?\.requestSubmit\(\);/);
  assert.match(form, /<LocalSavesFields \/>/);
  assert.doesNotMatch(form, /useT\(/, 'labels come from the page: the shell ships only part of `auth`');
  // The fallback polls only once opened.
  assert.match(form, /if \(open\) return children;/);
  // Sign-up's "this number already has an account" sends the code too.
  assert.match(read('app/(site)/compte/inscription/actions.js'), /const sent = await sendSignInCode\(customer\);/);
});

test('the code: right one proves the number and signs in; five wrong ones wipe it', () => {
  const src = read('app/(site)/compte/connexion/whatsappActions.js');
  const verify = src.slice(src.indexOf('export async function verifySignInCodeAction'), src.indexOf('async function finishSignIn'));
  assert.match(verify, /const attempt = await getVerifyAttempt\(\);/, 'the account comes from the signed cookie, never the form');
  assert.match(verify, /if \(noteWrongCode\(customer\.id\)\) \{\n\s+await setCustomerOtp\(customer\.id, \{ codeHash: null, expiresAt: null \}\);/);
  assert.match(verify, /await consumeCustomerOtp\(customer\.id\);\n\s+await finishSignIn\(customer, attempt\.phone, localSavesFromForm\(formData\), 'code'\);\n\s+redirect\(next\);/);
  assert.ok(verify.indexOf('new Date(customer.otp_expires_at) <= new Date()') < verify.indexOf('verifyOtp('), 'an expired code is refused before comparing');
});

test('sign-in code limits: 5 wrong tries per code, 3 sends per 10 minutes', async () => {
  const limits = await import('@/lib/signInCodeLimits');
  limits.resetSignInCodeLimits();
  for (let i = 1; i < limits.TRIES_PER_CODE; i += 1) assert.equal(limits.noteWrongCode(7), false, `try ${i}`);
  assert.equal(limits.noteWrongCode(7), true, 'the 5th wipes the code');
  assert.equal(limits.noteWrongCode(7), false, 'counting starts again for the next code');
  const t0 = 1_000_000;
  for (let i = 0; i < limits.SENDS_PER_WINDOW; i += 1) {
    assert.equal(limits.canSendCode(8, t0 + i), true);
    limits.noteCodeSent(8, t0 + i);
  }
  assert.equal(limits.canSendCode(8, t0 + 10), false, 'a 4th within 10 minutes is refused');
  assert.equal(limits.canSendCode(8, t0 + limits.SEND_WINDOW_MS + 5), true, 'and allowed again after');
  limits.noteWrongCode(9);
  limits.noteCodeSent(9, t0);
  for (let i = 1; i < limits.TRIES_PER_CODE; i += 1) assert.equal(limits.noteWrongCode(9), false, 'a new code resets the tries');
  limits.resetSignInCodeLimits();
});

test('the sent code needs the template, and CUSTOMER_SENT_CODE=off turns it off', async () => {
  const { signInCodeEnabled } = await import('@/lib/signInCode');
  const saved = { template: process.env.AGENT_OTP_TEMPLATE, flag: process.env.CUSTOMER_SENT_CODE };
  try {
    delete process.env.AGENT_OTP_TEMPLATE;
    delete process.env.CUSTOMER_SENT_CODE;
    assert.equal(signInCodeEnabled(), false, 'no template: a session message never reaches a cold number');
    process.env.AGENT_OTP_TEMPLATE = 'agent_auth_otp';
    assert.equal(signInCodeEnabled(), true);
    process.env.CUSTOMER_SENT_CODE = 'off';
    assert.equal(signInCodeEnabled(), false);
  } finally {
    if (saved.template === undefined) delete process.env.AGENT_OTP_TEMPLATE; else process.env.AGENT_OTP_TEMPLATE = saved.template;
    if (saved.flag === undefined) delete process.env.CUSTOMER_SENT_CODE; else process.env.CUSTOMER_SENT_CODE = saved.flag;
  }
});

// --- "Ce numéro a déjà un compte" signs them in ------------------------------

test('an existing number at sign-up goes to the WhatsApp code, unless move answers need the password path', () => {
  const src = read('app/(site)/compte/inscription/actions.js');
  const block = src.slice(src.indexOf('if (existing) {'), src.indexOf('let typedCode'));
  assert.match(block, /refusal: 'exists'/, 'still counted on the dashboard');
  assert.match(block, /if \(withAnswers\) return \{ error: 'exists'/);
  assert.match(block, /await existingAccountToWhatsApp\(\{ customer: existing, phone, next \}\)/);
  assert.match(src, /const href = proveAccountHref\('existing', next\);/);
  assert.match(read('app/(site)/compte/connexion/whatsapp/page.js'), /params\.compte === 'existant'/);
});

// --- the alert card in the /listings feed -------------------------------------

test('the feed alert saves the search, not the visit', () => {
  assert.equal(
    feedAlertQuery({ commune: 'Gombe', price_max: '600', page: '2', utm_source: 'fb', fbclid: 'x', lkp_fav_return: '9', sort: 'price' }),
    'commune=Gombe&price_max=600',
  );
  for (const key of ['page', 'utm_campaign', 'fbclid', 'lkp_auth_return', 'view']) assert.equal(isNotACriterion(key), true, key);
  for (const key of ['commune', 'price_max', 'ville', 'property_type']) assert.equal(isNotACriterion(key), false, key);
});

test('every listing of the city is the feed, not an alert: the card asks for a commune first', () => {
  assert.equal(feedAlertReady({ ville: 'toutes' }), false);
  assert.equal(feedAlertReady({}), false);
  assert.equal(feedAlertReady({ commune: 'Limete' }), true);
  assert.equal(feedAlertReady({ quartier: 'Righini' }), true);
  assert.equal(feedAlertReady({ ville: 'lubumbashi' }), true, 'another city is narrow enough');
  assert.equal(feedAlertOffersCommunes({ ville: 'toutes' }), true);
  assert.equal(feedAlertOffersCommunes({ ville: 'goma' }), false);
});

test('the card follows the 3rd result, before the "Pas encore trouvé ?" card', () => {
  assert.equal(FEED_ALERT_AFTER, 3);
  assert.equal(feedAlertIndex(12), 2);
  assert.equal(feedAlertIndex(2), 1);
  assert.equal(feedAlertIndex(0), -1);
  const split = read('components/ListingsSplitView.js');
  assert.ok(split.indexOf('<FeedAlertCard') < split.indexOf('<FeedRequestCard'), 'same slot: alert first');
  const card = read('components/FeedAlertCard.js');
  assert.match(card, /entry=\{ENTRY\}/);
  assert.match(card, /IntersectionObserver/, '"shown" only once actually on screen');
});

test('a saved search drops ad tags and resume markers (an alert from an ad landing is the search)', () => {
  const src = read('components/SaveSearchButton.js');
  assert.match(src, /if \(isNotACriterion\(key\)\) params\.delete\(key\);/);
  assert.match(src, /isSearchSaved\(savedQuery\)/);
});

// --- the reminder card ---------------------------------------------------------

test('the reminder comes after a 1st listing and opens the WhatsApp form in place', () => {
  assert.equal(VIEWED_THRESHOLD, 1);
  assert.equal(shouldNudge({ reason: 'listing_viewed', viewed: 0 }), false);
  assert.equal(shouldNudge({ reason: 'listing_viewed', viewed: 1 }), true);
  const nudge = read('components/SignupNudge.js');
  assert.doesNotMatch(nudge, /\/compte\/inscription/, 'no page change on 3G');
  assert.match(nudge, /dynamic\(\(\) => import\('\.\/AuthPromptModal'\)/);
});

test('the reminder sells the alert and saves it when the page is a search with a commune', () => {
  assert.deepEqual(nudgeNext('/listings', '?commune=Gombe&transaction_type=location&utm_source=fb'), {
    next: '/listings?commune=Gombe&transaction_type=location&utm_source=fb&lkp_auth_return=alert',
    alert: true,
  });
  assert.deepEqual(nudgeNext('/listings', '?ville=toutes'), { next: '/listings?ville=toutes', alert: false }, 'the whole feed is not an alert');
  assert.deepEqual(nudgeNext('/', ''), { next: '/', alert: false });
  assert.deepEqual(nudgeNext('/guides/x', '?a=1'), { next: '/guides/x?a=1', alert: false });
  const nudge = read('components/SignupNudge.js');
  assert.match(nudge, /t\(alert \? 'auth\.nudge\.ctaAlert' : 'auth\.nudge\.cta'\)/);
});

// --- asked on the page most visitors see -----------------------------------------

test('a listing page offers "homes like this one" mid-page on a phone, counted as listing_alert', () => {
  const page = read('app/(site)/listings/[id]/page.js');
  assert.match(page, /<div className="lg:hidden empty:hidden">\s+<ListingAlertCard query=\{alertQuery\} \/>/);
  assert.ok(page.indexOf('<ListingAlertCard') < page.indexOf('id="emplacement"'), 'before the map, not at the bottom');
  const card = read('components/ListingAlertCard.js');
  assert.match(card, /const ENTRY = 'listing_alert';/);
  assert.match(card, /trackCustomerSignup\('prompt_shown', ENTRY\)/);
  assert.match(card, /isSearchSaved\(query\)/, 'nothing once that alert is saved');
  assert.equal((read('components/SimilarAlertButton.js').match(/entry="listing_alert"/g) || []).length, 2);
});

// --- the WhatsApp tap itself ------------------------------------------------------

test('the visit step of the WhatsApp sheet can open the account in the same tap, never holding WhatsApp', () => {
  // Production splits the sheet (WhatsAppIntentPanel, 2026-11-21): the box
  // is in the panel, the call in the button's go().
  const panel = read('components/WhatsAppIntentPanel.js');
  assert.match(panel, /<input type="checkbox" name="openAccount" value="1" defaultChecked/);
  assert.match(panel, /go\(pendingIntent, \{ name, phone, openAccount: form\.get\('openAccount'\) === '1' \}\);/);
  const sheet = read('components/WhatsAppIntentSheet.js');
  const go = sheet.slice(sheet.indexOf('function go('), sheet.indexOf('function answerPrompt'));
  assert.match(go, /if \(contact\?\.openAccount && contact\.name && contact\.phone && !isLoggedInClient\(\)\)/);
  assert.match(go, /\}\)\.catch\(\(\) => \{\}\);\n\s+\}\n\s+show\(false\);\n\s+openWhatsApp\(target\);/, 'not awaited: WhatsApp opens in the same tap');
  const action = read('app/(site)/listings/whatsappAccountActions.js');
  assert.match(action, /entry: 'wa_sheet'/);
  assert.match(action, /await demoCustomerPhoneOr\(typed\)/);
  assert.match(action, /rateLimited\(`wa-sheet-account:\$\{key\}`, STARTS_PER_10_MIN\)/);
});

// --- one screen, one way ----------------------------------------------------------

test('number and name on one screen; the button says "Continuer", not WhatsApp', () => {
  const form = read('app/(site)/compte/connexion/WhatsAppSignInForm.js');
  assert.match(form, /name="name"[\s\S]*?required=\{needName\}/, 'always there, required only for a new number without one');
  assert.doesNotMatch(form, /WhatsAppIcon/);
  assert.match(form, /name="partner_code"/);
  assert.equal(fr.auth.whatsappSignIn.button, 'Continuer');
  assert.match(read('app/(site)/compte/connexion/whatsappActions.js'), /const typedCode = String\(formData\.get\('partner_code'\) \|\| ''\)\.trim\(\)\.slice\(0, 20\) \|\| null;/);
});

test('the sign-up page opens accounts without a password; only "Mon projet" keeps its own form', () => {
  const page = read('app/(site)/compte/inscription/page.js');
  const plain = page.slice(page.lastIndexOf('return ('));
  assert.match(plain, /<WhatsAppSignInForm/);
  assert.doesNotMatch(plain, /<SignupForm/);
  assert.match(page.slice(0, page.lastIndexOf('return (')), /<MoveOnboarding/);
});

// --- "votre compte est créé" ------------------------------------------------------

test('a new account is welcomed once, by first name, on the page they land on', async () => {
  const { welcomeName, welcomeFromCookie, WELCOME_COOKIE } = await import('@/lib/newAccountWelcome');
  assert.equal(welcomeName('Henoc  Mimbo'), 'Henoc');
  assert.equal(welcomeName(''), '');
  assert.equal(welcomeFromCookie(encodeURIComponent('Henoc')), 'Henoc');
  assert.equal(welcomeFromCookie('-'), '', 'an account without a usable name still gets the card');
  assert.equal(welcomeFromCookie(undefined), null);
  assert.equal(welcomeFromCookie('%E0%A4%A'), '', 'a broken cookie never throws');
  const session = read('lib/newCustomerSession.js');
  assert.match(session, /if \(welcome\) \{\n\s+\/\/[^\n]*\n[^\n]*\n\s+\(await cookies\(\)\)\.set\(WELCOME_COOKIE/);
  assert.match(session, /maxAge: WELCOME_MAX_AGE/);
  // The request / visit confirmation already says it; the WhatsApp sheet's account does not.
  assert.match(read('lib/guestAccount.js'), /welcome: entry === 'wa_sheet'/);
  const layout = read('app/(site)/layout.js');
  assert.match(layout, /const welcome = welcomeFromCookie\(\(await cookies\(\)\)\.get\(WELCOME_COOKIE\)\?\.value\);/);
  assert.match(layout, /<NewAccountWelcome name=\{welcome\} \/>/);
  const card = read('components/NewAccountWelcome.js');
  assert.match(card, new RegExp(`document\\.cookie = \\\`\\$\\{WELCOME_COOKIE\\}=; Max-Age=0`), 'cleared as it appears');
  assert.equal(WELCOME_COOKIE, 'lukka_welcome');
  for (const dict of [fr, en]) assert.match(dict.auth.whatsappSignIn.welcomeTitle, /\{name\}/);
});

// --- back from WhatsApp ---------------------------------------------------------

test('the WhatsApp-tap event is fired by trackLeadClick (not the outcome), with the similar search and the typed contact', () => {
  const src = read('lib/analyticsClient.js');
  const lead = src.slice(src.indexOf('export function trackLeadClick'), src.indexOf('export function trackWhatsAppSheet'));
  assert.match(lead, /new CustomEvent\(WHATSAPP_TAP_EVENT/);
  assert.match(lead, /similarQuery: similarAlertQuery\(listing\)/);
  const outcome = src.slice(src.indexOf('export function trackWhatsAppOutcome'));
  assert.doesNotMatch(outcome.slice(0, outcome.indexOf('\n}\n')), /WHATSAPP_TAP_EVENT/);
});

test('signing in from the offer lands on homes like this one, with the alert and the listing saved', () => {
  assert.equal(
    similarAlertNext('transaction_type=location&commune=Gombe', 387),
    '/listings?transaction_type=location&commune=Gombe&lkp_auth_return=alert&lkp_fav_return=387',
  );
  assert.equal(similarAlertNext(null, 387), null);
  assert.equal(similarAlertNext('', 387), null);
  // The sheet is its own lazily loaded chunk (ContactSignupSheet, 2026-11-22).
  assert.match(read('components/ContactSignupPrompt.js'), /offer=\{offer\}/);
  const sheet = read('components/ContactSignupSheet.js');
  assert.match(sheet, /defaultE164=\{knownPhone\}/);
  assert.doesNotMatch(sheet, /from '@\/lib\/phone'/, 'the phone helpers stay in the lazily loaded form');
});

// --- homepage bell and the alert page ------------------------------------------

test('the home search offers its own search as an alert once it names a commune', () => {
  const src = read('components/SearchBar.js');
  assert.match(src, /const alertQuery = feedAlertReady\(stagedParams\) \? feedAlertQuery\(stagedParams\) : null;/);
  assert.match(src, /entry="home_hero"/);
  assert.match(src, /const qs = stagedQuery\(\);/, 'the count and the bell read the same search');
});

test('/alertes-whatsapp: one screen, real figures only, not indexed', () => {
  const page = read('app/(site)/alertes-whatsapp/page.js');
  assert.match(page, /<HomeAlertPicker popular=\{withListings\} others=\{others\} entry="alert_landing" \/>/);
  assert.match(page, /robots: \{ index: false, follow: true \}/);
  assert.match(page, /weeklyNew > 0 \?/);
});

// --- funnel and copy -------------------------------------------------------------

test('every new entry is known to the funnel and labelled on the dashboard', () => {
  for (const entry of ['feed_alert', 'request', 'visit', 'home_hero', 'alert_landing', 'after_whatsapp', 'whatsapp', 'listing_alert', 'wa_sheet']) {
    assert.ok(SIGNUP_ENTRIES.includes(entry), entry);
    assert.ok(entry.length <= 32, 'the column holds 32 characters');
    for (const dict of [fr, en]) assert.ok(dict.admin.growth.signup.entries[entry], `${entry} label`);
  }
  for (const entry of ['feed_alert', 'request', 'visit', 'home_hero', 'alert_landing', 'listing_alert', 'wa_sheet']) assert.ok(PROMPT_ENTRIES.has(entry), entry);
});

test('every new string exists in French and English, and the request card no longer says "sans compte"', () => {
  for (const dict of [fr, en]) {
    for (const key of ['title', 'body', 'bodyFor', 'commune', 'communePlaceholder', 'button', 'footnote']) assert.ok(dict.listings.feedAlert[key], key);
    for (const status of ['created', 'existing', 'offer']) {
      for (const key of ['title', 'body', 'cta']) assert.ok(dict.listings.accountOffer[status][key], `${status}.${key}`);
    }
    for (const key of ['metaTitle', 'title', 'lead', 'perkFree', 'perkNoPassword', 'perkStop']) assert.ok(dict.listings.alertLanding[key], key);
    assert.ok(dict.listings.contactSignup.titleSimilar && dict.listings.contactSignup.perkSimilar && dict.listings.contactSignup.leadKnown);
    assert.ok(dict.listings.authPrompt.nudge && dict.listings.authPrompt.reasons.nudge);
    assert.ok(dict.home.search.alertMe && dict.auth.whatsappSignIn.existingAccount && dict.enquiry.openAccountHint);
    assert.match(dict.listings.feedAlert.bodyFor, /\{search\}/);
  }
  assert.doesNotMatch(fr.listings.results.feedRequestBody, /sans compte/);
});

test('the WhatsApp code screen is reachable before any session', () => {
  assert.match(read('middleware.js'), /'\/compte\/connexion\/whatsapp',/);
});
