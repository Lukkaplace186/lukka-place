import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Espace Client tab bar is a funnel, and its ORDER is the product
 * decision — not a detail of how the array happens to be written.
 *
 * Read as source text rather than imported: these are `'use client'`
 * components and Server Components, and this suite runs under
 * `--conditions=react-server`. The same reason tests/unit/i18n-namespaces.js
 * walks files with readFileSync instead of importing them.
 *
 * What this pins is the loop:
 *   tab 2 (Trouver pour moi) submits  -> lands on tab 3
 *   tab 3 (Messages & Visites) empty  -> points back at tab 2
 * Break either direction and a customer either meets an empty inbox before
 * being offered the form that fills it, or fills the form and is left on it
 * with no idea what happens next. Both were real states of this page.
 */

const ROOT = process.cwd();

function read(file) {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

const TABS_FILE = 'app/(site)/compte/client/ClientPortalTabs.js';
const ACTIONS_FILE = 'app/(site)/compte/client/actions.js';
const MESSAGES_FILE = 'app/(site)/compte/client/messages/page.js';

/** The `href` values of the TABS array, in the order they are declared. */
function declaredTabOrder() {
  const source = read(TABS_FILE);
  const block = source.slice(source.indexOf('const TABS = ['), source.indexOf('];', source.indexOf('const TABS = [')));
  return [...block.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
}

test('the portal tabs follow the customer journey, not an arbitrary order', () => {
  assert.deepEqual(declaredTabOrder(), [
    '/compte/client', // 1. Favoris & Alertes — what they saved while browsing
    '/compte/client/demandes', // 2. Trouver pour moi — the request they make next
    '/compte/client/messages', // 3. Messages & Visites — where it is answered
    '/compte/client/parametres', // not part of the funnel; stays last
  ]);
});

test('"Trouver pour moi" is offered BEFORE the tab that tracks its answers', () => {
  const order = declaredTabOrder();
  assert.ok(
    order.indexOf('/compte/client/demandes') < order.indexOf('/compte/client/messages'),
    'the request form must come before the inbox it fills',
  );
});

test('submitting a request hands the customer to the tracking tab, not back to the form', () => {
  const source = read(ACTIONS_FILE);
  assert.match(
    source,
    /redirect\(leadId \? `\/compte\/client\/messages\?submitted=\$\{leadId\}` : '\/compte\/client\/messages'\)/,
    'submitPropertyRequestAction must redirect to Messages & Visites',
  );
  assert.doesNotMatch(
    source,
    /return \{ status: 'success'/,
    'an inline success banner on the form is the dead end this redirect replaced',
  );
});

test('the redirect sits outside the try/catch that reports a send failure', () => {
  // redirect() signals by throwing. Inside that catch it would be reported to
  // the customer as "your request could not be sent" for a lead that was in
  // fact created — the worst possible lie for this particular screen.
  const source = read(ACTIONS_FILE);
  const catchIndex = source.indexOf("message: t('errors.requestNotSent')");
  const redirectIndex = source.indexOf("redirect(leadId ?");
  assert.ok(catchIndex !== -1 && redirectIndex !== -1);
  assert.ok(redirectIndex > catchIndex, 'the redirect must come after the catch block, never inside it');
});

test('the tracking tab confirms only a request that is really the caller’s own', () => {
  const source = read(MESSAGES_FILE);
  assert.match(
    source,
    /const confirmed = justSubmitted != null && threads\.some\(\(thread\) => thread\.id === justSubmitted\)/,
    '?submitted= must be matched against this session’s own threads before anything is confirmed',
  );
});

test('the empty tracking tab points back at the tab that fills it', () => {
  const source = read(MESSAGES_FILE);
  assert.match(source, /actionHref="\/compte\/client\/demandes"/, 'the empty state needs a route back to the form');
  assert.match(
    source,
    /actionLabel=\{t\('account\.portal\.tabs\.findForMe'\)\}/,
    'the button label must come from the dictionary, not a hardcoded French string',
  );
});
