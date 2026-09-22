import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset, getPool } from '../support/fakePool.js';
import {
  BUDGET_TOLERANCE,
  buildClientListingMessage,
  clientFirstName,
  clientListingUrl,
  clientMatchesListing,
  clientMismatchReason,
  clientWhatsAppLink,
  communeKey,
  matchClientsToListings,
  matchEntriesByListing,
  matchEntriesForClient,
  matchEntriesForListing,
  parseClientFields,
  resolveCommunes,
  withinBudget,
} from '@/lib/clientMatching';
import {
  alternativeUrl,
  alternativesCriteria,
  buildAlternativesMessage,
  parseLeadCommunes,
  rankAlternatives,
} from '@/lib/listingAlternatives';
import { listingPublicUrl } from '@/lib/listingShareCopy';
import {
  createAgentClient,
  deleteAgentClient,
  getMatchableOwnListings,
  listAgentClients,
  listClientContacts,
  recordClientContact,
  updateAgentClient,
} from '@/lib/agentClients';

/**
 * Agent client book + "Proposer des alternatives" (web/CLAUDE.md, 2026-09-22).
 * The matcher is pure and pinned rule by rule; the SQL is pinned on its text —
 * every client-book statement must be scoped to the session agent, which a
 * row-comparison test could never prove.
 */

beforeEach(() => reset());

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

const live = (overrides = {}) => ({
  id: '101',
  title: 'Appartement 2 chambres',
  purpose: 'rent',
  price: 500,
  price_period: null,
  beds: 2,
  commune: 'Ngiri-Ngiri',
  quartier: 'Saio',
  status: 1,
  approve_status: 1,
  listing_status: 'active',
  created_at: '2026-09-10T10:00:00Z',
  ...overrides,
});

const client = (overrides = {}) => ({
  id: '7',
  name: 'Marie Nsumbu',
  phone: '243812345678',
  transaction_type: 'location',
  communes: ['Ngiri-Ngiri'],
  budget_min: null,
  budget_max: 500,
  bedrooms: 2,
  ...overrides,
});

// --- the matcher ---------------------------------------------------------------

test('a listing that fits on all four rules matches', () => {
  assert.equal(clientMismatchReason(client(), live()), null);
  assert.equal(clientMatchesListing(client(), live()), true);
});

test('purpose must match exactly — a tenant is never offered a sale', () => {
  assert.equal(clientMismatchReason(client(), live({ purpose: 'sale' })), 'purpose');
  assert.equal(clientMismatchReason(client({ transaction_type: 'vente' }), live({ purpose: 'sale' })), null);
  assert.equal(clientMismatchReason(client({ transaction_type: 'bogus' }), live()), 'purpose');
});

test('commune: one of the client communes, compared without accents, case or separators', () => {
  assert.equal(communeKey('Ngiri Ngiri'), communeKey('ngiri-ngiri'));
  assert.equal(communeKey('Kinshasa É'), 'kinshasa-e');
  assert.equal(clientMismatchReason(client({ communes: ['ngiri ngiri'] }), live()), null);
  assert.equal(clientMismatchReason(client({ communes: ['Gombe', 'Limete'] }), live()), 'commune');
  assert.equal(clientMismatchReason(client(), live({ commune: null })), 'commune', 'an untagged listing is not claimed to fit');
  assert.equal(clientMismatchReason(client({ communes: [] }), live({ commune: null })), null, 'no communes = anywhere');
});

test('budget: ±10 % either side, inclusive, and a constrained budget refuses an unknown price', () => {
  assert.equal(BUDGET_TOLERANCE, 0.1);
  assert.equal(withinBudget(550, null, 500), true);
  assert.equal(withinBudget(551, null, 500), false);
  assert.equal(withinBudget(270, 300, null), true);
  assert.equal(withinBudget(269, 300, null), false);
  assert.equal(withinBudget(null, null, null), true);
  assert.equal(withinBudget(null, null, 500), false);
  assert.equal(withinBudget(0, 100, 500), false);
  assert.equal(clientMismatchReason(client(), live({ price: 600 })), 'budget');
  assert.equal(clientMismatchReason(client(), live({ price: '540.00' })), null, 'numeric strings from pg');
});

test('bedrooms: at least what the client asked for; an unknown count does not match', () => {
  assert.equal(clientMismatchReason(client({ bedrooms: 2 }), live({ beds: 3 })), null);
  assert.equal(clientMismatchReason(client({ bedrooms: 3 }), live({ beds: 2 })), 'bedrooms');
  assert.equal(clientMismatchReason(client({ bedrooms: 2 }), live({ beds: null })), 'bedrooms');
  assert.equal(clientMismatchReason(client({ bedrooms: null }), live({ beds: null })), null);
  assert.equal(clientMismatchReason(client({ bedrooms: 0 }), live({ beds: null })), null);
});

test('only a listing a customer can open is matched — pending, archived, under offer, closed are not', () => {
  for (const overrides of [
    { approve_status: 0 },
    { approve_status: 2 },
    { status: 0 },
    { listing_status: 'under_offer' },
    { listing_status: 'closed' },
  ]) {
    assert.equal(clientMismatchReason(client(), live(overrides)), 'unavailable', JSON.stringify(overrides));
  }
});

test('matches are indexed both ways, keyed by string ids', () => {
  const clients = [client({ id: 1 }), client({ id: 2, transaction_type: 'vente' }), client({ id: 3, communes: [] })];
  const listings = [live({ id: 10 }), live({ id: 11, purpose: 'sale', price: 400 }), live({ id: 12, commune: 'Gombe' })];
  const { byListing, byClient } = matchClientsToListings(clients, listings);
  assert.deepEqual(byListing, { 10: ['1', '3'], 11: ['2'], 12: ['3'] });
  assert.deepEqual(byClient, { 1: ['10'], 2: ['11'], 3: ['10', '12'] });
});

test('the link sent to a client is tracked, and the wa.me link targets the client number', () => {
  assert.equal(
    clientListingUrl(101),
    'https://lukkaplace.com/listings/101?utm_source=whatsapp&utm_medium=agent&utm_campaign=client_book',
  );
  const href = clientWhatsAppLink(client(), live());
  assert.match(href, /^https:\/\/wa\.me\/243812345678\?text=/);
  const text = decodeURIComponent(href.split('?text=')[1]);
  assert.match(text, /^Bonjour Marie,/);
  assert.match(text, /Appartement 2 chambres — Saio, Ngiri-Ngiri — 500 \$ \/ mois/);
  assert.ok(text.trim().endsWith(clientListingUrl('101')), 'link last');
  assert.equal(clientWhatsAppLink(client({ phone: '12' }), live()), null);
});

test('a phone-shaped name gets no greeting', () => {
  assert.equal(clientFirstName('243812345678'), null);
  assert.equal(clientFirstName('  Élodie Kabila'), 'Élodie');
  assert.match(buildClientListingMessage(client({ name: '243 81' }), live()), /^Bonjour,\n/);
});

test('match entries carry the "WhatsApp opened" marker per client × listing', () => {
  const book = {
    clients: [client({ id: '1' }), client({ id: '2', name: 'Paul' })],
    listings: [live({ id: '10' }), live({ id: '11', purpose: 'sale' })],
    contacts: { '1:10': '2026-09-20T08:00:00.000Z' },
  };
  Object.assign(book, matchClientsToListings(book.clients, book.listings));
  const forListing = matchEntriesForListing(book, book.listings[0]);
  assert.deepEqual(forListing.map((e) => [e.clientId, e.contactedAt]), [['1', '2026-09-20T08:00:00.000Z'], ['2', null]]);
  const forClient = matchEntriesForClient(book, book.clients[0]);
  assert.equal(forClient.length, 1);
  assert.equal(forClient[0].price, '500 $ / mois');
  assert.deepEqual(Object.keys(matchEntriesByListing(book)), ['10'], 'no entry for a listing nobody wants');
});

// --- the form -------------------------------------------------------------------

const VALID = ['Gombe', 'Ngiri-Ngiri', 'Limete'];
const fields = (overrides = {}) => ({
  name: '  Marie   Nsumbu ',
  phone: '243812345678',
  transaction_type: 'location',
  communes: ['gombe', 'Ngiri Ngiri', 'Gombe'],
  budget_min: '300',
  budget_max: '1 000 $',
  bedrooms: '2',
  notes: '  Préfère un rez-de-chaussée ',
  ...overrides,
});

test('a valid form is normalised: canonical communes, numbers, trimmed text', () => {
  const result = parseClientFields(fields(), { validCommunes: VALID });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: 'Marie Nsumbu',
    phone: '243812345678',
    transaction_type: 'location',
    communes: ['Gombe', 'Ngiri-Ngiri'],
    budget_min: 300,
    budget_max: 1000,
    bedrooms: 2,
    notes: 'Préfère un rez-de-chaussée',
  });
});

test('a commune not on the real list is refused, never stored as free text', () => {
  assert.deepEqual(resolveCommunes(['Gombe', 'Paris'], VALID), { communes: ['Gombe'], unknown: ['Paris'] });
  assert.equal(parseClientFields(fields({ communes: ['Paris'] }), { validCommunes: VALID }).errorKey, 'agent.clients.errors.commune');
  assert.equal(parseClientFields(fields({ communes: ['Gombe'] }), { validCommunes: [] }).errorKey, 'agent.clients.errors.commune');
});

test('the form refuses what the table would refuse', () => {
  const key = (overrides) => parseClientFields(fields(overrides), { validCommunes: VALID }).errorKey;
  assert.equal(key({ name: '' }), 'agent.clients.errors.name');
  assert.equal(key({ name: 'x'.repeat(121) }), 'agent.clients.errors.name');
  assert.equal(key({ phone: null }), 'agent.clients.errors.phone');
  assert.equal(key({ transaction_type: 'rent' }), 'agent.clients.errors.purpose');
  assert.equal(key({ budget_min: '900', budget_max: '500' }), 'agent.clients.errors.budget');
  assert.equal(key({ budget_max: '-5' }), 'agent.clients.errors.budget');
  assert.equal(key({ budget_max: 'abc' }), 'agent.clients.errors.budget');
  assert.equal(key({ bedrooms: '2.5' }), 'agent.clients.errors.bedrooms');
  assert.equal(key({ notes: 'x'.repeat(2001) }), 'agent.clients.errors.notes');
  const empty = parseClientFields(fields({ communes: [], budget_min: '', budget_max: '', bedrooms: '', notes: '' }), {
    validCommunes: VALID,
  });
  assert.deepEqual(
    [empty.value.communes, empty.value.budget_min, empty.value.budget_max, empty.value.bedrooms, empty.value.notes],
    [[], null, null, null, null],
  );
});

test('both actions normalise the phone with the picked country and fetch communes server-side', () => {
  const src = read('app/compte/agent/clientActions.js');
  assert.match(src, /phoneFromForm\(formData, 'phone'\)/);
  assert.match(src, /getLocationHierarchyWithFallback\(\)/);
  assert.doesNotMatch(src, /validCommunes, formData/, 'no client-supplied allow-list');
});

// --- SQL: every statement is scoped to the session agent ---------------------------

test('every client-book statement is scoped on agent_id with the session agent', async () => {
  const value = parseClientFields(fields(), { validCommunes: VALID }).value;
  enqueue([]);
  await listAgentClients(42);
  enqueue([{ id: 9 }]);
  await createAgentClient(42, value);
  enqueue([{ id: 9 }]);
  await updateAgentClient(42, '9', value);
  enqueue([{ id: 9 }]);
  await deleteAgentClient(42, '9');
  enqueue([]);
  await listClientContacts(42);
  enqueue([{ contacted_at: new Date('2026-09-22T09:00:00Z') }]);
  const contact = await recordClientContact(42, '9', '101');

  assert.equal(calls.length, 6);
  for (const call of calls) {
    assert.equal(call.values[0], 42, call.sql);
  }
  assert.match(calls[0].sql, /FROM agent_clients WHERE agent_id = \$1/);
  assert.match(calls[2].sql, /WHERE agent_id = \$1 AND id = \$10/);
  assert.match(calls[3].sql, /DELETE FROM agent_clients WHERE agent_id = \$1 AND id = \$2/);
  assert.match(calls[4].sql, /FROM agent_client_contacts WHERE agent_id = \$1/);
  // The marker can only join the agent's OWN client to the agent's OWN listing.
  assert.match(calls[5].sql, /JOIN properties p ON p\.id = \$3 AND p\.agent_id = \$1/);
  assert.match(calls[5].sql, /WHERE c\.id = \$2 AND c\.agent_id = \$1/);
  assert.deepEqual(contact, { ok: true, contactedAt: '2026-09-22T09:00:00.000Z' });
});

test('a forged id writes nothing and says not found', async () => {
  const value = parseClientFields(fields(), { validCommunes: VALID }).value;
  enqueue([]);
  assert.deepEqual(await updateAgentClient(42, '999', value), { ok: false, reason: 'not_found' });
  enqueue([]);
  assert.deepEqual(await deleteAgentClient(42, '999'), { ok: false, reason: 'not_found' });
  enqueue([]);
  assert.deepEqual(await recordClientContact(42, '999', '101'), { ok: false, reason: 'not_found' });
});

test('before the migration runs, the book reads empty and writes answer "unavailable"', async () => {
  const pool = getPool();
  const original = pool.query;
  pool.query = async () => {
    throw Object.assign(new Error('relation "agent_clients" does not exist'), { code: '42P01' });
  };
  try {
    assert.deepEqual(await listAgentClients(42), { available: false, clients: [] });
    assert.deepEqual(await listClientContacts(42), {});
    const value = parseClientFields(fields(), { validCommunes: VALID }).value;
    assert.deepEqual(await createAgentClient(42, value), { ok: false, reason: 'unavailable' });
  } finally {
    pool.query = original;
  }
});

test('a duplicate number is a friendly refusal, not a 500', async () => {
  const pool = getPool();
  const original = pool.query;
  pool.query = async () => {
    throw Object.assign(new Error('duplicate key'), { code: '23505' });
  };
  try {
    const value = parseClientFields(fields(), { validCommunes: VALID }).value;
    assert.deepEqual(await createAgentClient(42, value), { ok: false, reason: 'duplicate' });
  } finally {
    pool.query = original;
  }
});

test('matchable listings: the agent own, public-gated, active only', async () => {
  enqueue([{ id: 5, listing_status: null, commune: 'Gombe' }]);
  const rows = await getMatchableOwnListings(42);
  const { sql, values } = calls[0];
  assert.match(sql, /p\.agent_id = \$1 AND p\.status = 1 AND p\.approve_status = 1/);
  assert.match(sql, /COALESCE\(p\.listing_status, 'active'\) = 'active'/);
  assert.match(sql, /amenity_id BETWEEN 21 AND 44/, 'commune resolved from the amenity tag');
  assert.deepEqual(values, [42]);
  assert.deepEqual(rows, [{ id: '5', listing_status: 'active', commune: 'Gombe' }]);
});

test('nothing outside the agent dashboard reads the client book', () => {
  const offenders = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx|mjs)$/.test(entry) && /agent_clients|agentClients/.test(readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(process.cwd(), full).split(path.sep).join('/'));
      }
    }
  })(path.join(process.cwd(), 'app'));
  for (const file of offenders) assert.match(file, /^app\/compte\/agent\//, file);
  assert.doesNotMatch(read('../services/leadDispatch.js'), /agent_clients/);
});

test('the migration is idempotent, bigint, cascading, and revoked from PostgREST roles', () => {
  const sql = read('../migrations/20260922_agent_clients.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_clients/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_client_contacts/);
  assert.match(sql, /id\s+BIGINT GENERATED BY DEFAULT AS IDENTITY/);
  assert.match(sql, /agent_id\s+BIGINT NOT NULL REFERENCES agents \(id\) ON DELETE CASCADE/);
  assert.match(sql, /property_id\s+BIGINT NOT NULL REFERENCES properties \(id\) ON DELETE CASCADE/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS agent_clients_agent_idx ON agent_clients \(agent_id/);
  assert.match(sql, /REVOKE ALL ON agent_clients FROM/);
  assert.doesNotMatch(sql, /CREATE (TABLE|INDEX|UNIQUE INDEX) (?!IF NOT EXISTS)/);
});

test('the client book is hidden: no nav entry, and its old URL redirects to Demandes', () => {
  const src = read('components/AgentSidebar.js');
  assert.doesNotMatch(src, /\/compte\/agent\/clients/);
  assert.match(src, /repeat\(\$\{NAV\.length\}/, 'phone bar columns follow NAV');
  assert.match(read('app/compte/agent/clients/page.js'), /redirect\('\/compte\/agent\/demandes'\)/);
});

// --- alternatives -------------------------------------------------------------------

test('alternative links carry the exact tracking the brief asks for; plain share links are unchanged', () => {
  assert.equal(
    alternativeUrl(286),
    'https://lukkaplace.com/listings/286?utm_source=whatsapp&utm_medium=agent&utm_campaign=alternatives',
  );
  assert.equal(listingPublicUrl(286, { source: 'wa_status' }), 'https://lukkaplace.com/listings/286?utm_source=wa_status');
  assert.equal(listingPublicUrl(286), 'https://lukkaplace.com/listings/286');
});

test('criteria: the request wins, the declined listing stands in for what it does not say', () => {
  assert.deepEqual(parseLeadCommunes({ communes: '["Gombe","Limete","Gombe"]', commune: 'Gombe' }), ['Gombe', 'Limete']);
  assert.deepEqual(parseLeadCommunes({ communes: 'not json', commune: 'Bandal' }), ['Bandal']);
  assert.deepEqual(parseLeadCommunes({ lead_commune: 'Lemba' }), ['Lemba']);

  const fromLead = alternativesCriteria({
    lead: { transaction_type: 'vente', communes: '["Gombe"]', price_min: 50000, price_max: null, bedrooms: 3 },
    listing: { purpose: 'rent', commune: 'Limete', price: 700, beds: 2 },
  });
  assert.deepEqual(fromLead, { purpose: 'sale', communes: ['Gombe'], price_min: 50000, price_max: null, bedrooms: 3 });

  const fromListing = alternativesCriteria({ lead: {}, listing: { purpose: 'rent', commune: 'Limete', price: '700', beds: 2 } });
  assert.deepEqual(fromListing, { purpose: 'rent', communes: ['Limete'], price_min: null, price_max: 700, bedrooms: 2 });
});

test('ranking: purpose is hard, the declined listing is never offered, same commune first, then fit', () => {
  const criteria = { purpose: 'rent', communes: ['Limete'], price_min: null, price_max: 700, bedrooms: 2 };
  const candidates = [
    live({ id: 1, commune: 'Gombe', price: 650 }),
    live({ id: 2, commune: 'Limete', price: 1400 }),
    live({ id: 3, commune: 'Limete', price: 690 }),
    live({ id: 4, purpose: 'sale', commune: 'Limete' }),
    live({ id: 5, commune: 'Limete', listing_status: 'under_offer' }),
    live({ id: 6, commune: 'Limete', price: 600 }),
    live({ id: 3, commune: 'Limete', price: 690 }),
  ];
  const ranked = rankAlternatives(candidates, criteria, { excludeIds: ['6'] });
  assert.deepEqual(ranked.map((e) => String(e.listing.id)), ['3', '2', '1']);
  assert.deepEqual(ranked.map((e) => e.communeMatch), [true, true, false]);
});

test('the one message holds at most three listings, each with its tracked link, in French', () => {
  const listings = [1, 2, 3, 4].map((id) => live({ id, title: `Bien ${id}` }));
  const text = buildAlternativesMessage(listings, { name: 'Jean Mbala' });
  assert.match(text, /^Bonjour Jean,/);
  assert.match(text, /Voici 3 autres biens/);
  assert.equal((text.match(/utm_campaign=alternatives/g) || []).length, 3);
  assert.doesNotMatch(text, /Bien 4/);
  assert.match(buildAlternativesMessage([live()], {}), /^Bonjour,\n\nVoici un autre bien/);
});

test('the send path rebuilds the text server-side and re-reads listings under the public filter', () => {
  const src = read('app/compte/agent/alternativesActions.js');
  assert.match(src, /buildAlternativesMessage\(chosen\.listings/);
  assert.match(src, /resolveOwnedTarget\(agentId, kind, id\)/);
  const lib = read('lib/agentAlternatives.js');
  assert.match(lib, /getListingsByIds\(ids\)/);
  assert.match(lib, /\.\.\.context\.leadScope/, 'pushed leads (matchedAgentId) are included');
});
