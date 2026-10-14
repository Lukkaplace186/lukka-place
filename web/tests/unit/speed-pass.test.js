import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('the hero pins a 640w source on phones and fetches at high priority', () => {
  const hero = read('components/Hero.js');
  assert.match(hero, /<source media="\(max-width: 640px\)" srcSet=\{mobile\} \/>/);
  assert.match(hero, /fetchPriority: 'high', loading: 'eager'/);
  assert.ok(!/\bpriority\b\s*$/m.test(hero) && !/^\s*priority$/m.test(hero), 'priority is deprecated in Next 16');
});

test('project copy ships from /projets only, not with every public page', () => {
  const site = read('app/(site)/layout.js');
  const list = site.match(/SITE_NAMESPACES = \[([^\]]*)\]/)[1];
  assert.ok(!/'projects'/.test(list));
  assert.match(read('app/(site)/projets/layout.js'), /PROJECT_NAMESPACES = \['projects'\]/);
});

test('www.lukkaplace.com redirects to lukkaplace.com, so there is one sign-in', async () => {
  const { default: config } = await import('../../next.config.mjs');
  const rules = await config.redirects();
  const www = rules.find((r) => r.has?.some((h) => h.type === 'host' && h.value === 'www.lukkaplace.com'));
  assert.ok(www, 'a host redirect for www exists');
  assert.equal(www.destination, 'https://lukkaplace.com/:path*');
  assert.equal(www.permanent, true);
});

test('the header knows an agent is signed in: one flag name on both sides, set with the session, cleared on logout', () => {
  const auth = read('lib/agentAuth.js');
  assert.match(auth, /AGENT_LOGGED_IN_FLAG_COOKIE = 'lukka_agent_logged_in'/);
  assert.match(read('lib/customerClient.js'), /c === 'lukka_agent_logged_in=1'/);
  const session = read('lib/agentSession.js');
  assert.match(session, /cookieStore\.set\(AGENT_LOGGED_IN_FLAG_COOKIE, '1'/);
  assert.match(session, /cookieStore\.delete\(\{ name: AGENT_LOGGED_IN_FLAG_COOKIE, path: '\/' \}\)/);
  const header = read('components/Header.js');
  assert.match(header, /agentSignedIn \? '\/compte\/agent' : '\/compte\/agent\/inscription'/);
  assert.match(header, /agentSignedIn \? '\/compte\/agent\/demandes' : '\/compte\/agent\/connexion'/);
  assert.match(read('app/(site)/compte/agent/connexion/page.js'), /getCurrentAgentId\(\)[\s\S]*redirect\(/);
});
