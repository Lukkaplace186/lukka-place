import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canMessageListing,
  chatStartHref,
  CHAT_MESSAGE_MAX,
  CHAT_PREVIEW_MAX,
  CHAT_SEND_PER_MINUTE,
  createRateLimiter,
  decodeInboxCursor,
  encodeInboxCursor,
  messagePreview,
  normaliseClientId,
  normaliseInboxFilter,
  normaliseMessageBody,
  otherRole,
  parseId,
  shortPersonName,
} from '@/lib/chatRules';
import {
  CHAT_PUBLIC_LISTING_FILTER,
  CHAT_REACHABLE_AGENT_FILTER,
  findCustomerThreadId,
  getChatTarget,
  getThread,
  listMessages,
  listShareableListings,
  listThreads,
  markRead,
  reportThread,
  sendMessage,
  setBlocked,
  startThread,
} from '@/lib/chat';
import { CHAT_STATUS_HTTP, readChatJson } from '@/lib/chatApi';
import { chatClock, chatDayKey, chatDayLabel, chatInboxTime, chatWaitLabel } from '@/lib/chatTime';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Messagerie, phase 1 (lib/chatRules.js, lib/chat.js, lib/chatApi.js;
 * engine migrations/20261105_chat.sql). What these pin:
 *  - every read and write is scoped to the signed-in side in SQL, so a
 *    guessed thread id reaches nothing;
 *  - a customer can only reach an agent the listing page would show, and
 *    with a listing the agent comes from the listing, not the request;
 *  - the send path: blocked threads, idempotent retries, agents sharing only
 *    their own public listings, the rate limit.
 */

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const listingsSource = readFileSync(path.join(WEB_ROOT, 'lib', 'listings.js'), 'utf8');
const migration = readFileSync(path.join(WEB_ROOT, '..', 'migrations', '20261105_chat.sql'), 'utf8');

const customer = (id = 11) => ({ role: 'customer', id });
const agent = (id = 7) => ({ role: 'agent', id });

const MESSAGE_ROW = (over = {}) => ({
  id: 101,
  sender_role: 'customer',
  kind: 'text',
  body: 'Bonjour',
  property_id: null,
  payload: null,
  client_id: null,
  created_at: '2026-11-05T10:00:00.000Z',
  ...over,
});

test.beforeEach(() => reset());

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('a message body keeps the sender\'s words and paragraphs, nothing else', () => {
  assert.deepEqual(normaliseMessageBody('  Bonjour\r\n\r\n\r\n\r\nEst-il libre ?  '), { ok: true, body: 'Bonjour\n\nEst-il libre ?' });
  assert.deepEqual(normaliseMessageBody('a\u0000b\u0007c\td'), { ok: true, body: 'abc\td' });
  assert.deepEqual(normaliseMessageBody('   \n  '), { ok: false, error: 'empty' });
  assert.deepEqual(normaliseMessageBody(null), { ok: false, error: 'empty' });
  assert.equal(normaliseMessageBody('x'.repeat(CHAT_MESSAGE_MAX)).ok, true);
  assert.deepEqual(normaliseMessageBody('x'.repeat(CHAT_MESSAGE_MAX + 1)), { ok: false, error: 'too-long' });
});

test('the limits are the ones the migration enforces', () => {
  assert.ok(migration.includes(`char_length(body) BETWEEN 1 AND ${CHAT_MESSAGE_MAX}`));
  assert.ok(migration.includes(`char_length(last_message_preview) <= ${CHAT_PREVIEW_MAX}`));
});

test('ids, client ids and filters are parsed strictly', () => {
  assert.equal(parseId('12'), 12);
  assert.equal(parseId(12), 12);
  for (const bad of ['12a', '0', '-3', '', null, undefined, '1.5', ' 12x']) assert.equal(parseId(bad), null, String(bad));
  assert.equal(normaliseClientId('6F1C2D3E-4A5B-4C6D-8E9F-0A1B2C3D4E5F'), '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f');
  assert.equal(normaliseClientId('not-a-uuid'), null);
  assert.equal(normaliseInboxFilter('unread'), 'unread');
  assert.equal(normaliseInboxFilter('DROP'), 'all');
  assert.equal(otherRole('agent'), 'customer');
  assert.equal(otherRole('customer'), 'agent');
});

test('the inbox preview is one line, cut on a word, and names cards for what they are', () => {
  assert.equal(messagePreview({ body: 'Oui,\n\nil est   libre.' }), 'Oui, il est libre.');
  const long = messagePreview({ body: 'mot '.repeat(80) });
  assert.ok(long.length <= CHAT_PREVIEW_MAX);
  assert.ok(long.endsWith('…'));
  assert.ok(!long.endsWith(' …'));
  assert.equal(messagePreview({ kind: 'listing', body: null }), 'Bien partagé');
});

test('a customer is shown to an agent as first name and initial, never as a phone number', () => {
  assert.equal(shortPersonName('Grace Kabila Mwamba'), 'Grace M.');
  assert.equal(shortPersonName('Grace'), 'Grace');
  assert.equal(shortPersonName('243812345678'), null);
  assert.equal(shortPersonName('+243 812 345 678'), null);
  assert.equal(shortPersonName('  '), null);
});

test('the inbox cursor round-trips and refuses junk', () => {
  const cursor = encodeInboxCursor({ id: 42, last_message_at: '2026-11-05T10:42:00Z' });
  assert.deepEqual(decodeInboxCursor(cursor), { at: '2026-11-05T10:42:00.000Z', id: 42 });
  assert.equal(decodeInboxCursor('nonsense'), null);
  assert.equal(decodeInboxCursor('not-a-date|4'), null);
  assert.equal(decodeInboxCursor('2026-11-05T10:42:00Z|x'), null);
});

test('the rate limiter is a sliding window', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.take('a'), true);
  assert.equal(limiter.take('a'), true);
  assert.equal(limiter.take('a'), false);
  assert.equal(limiter.take('b'), true, 'keys are independent');
  now = 1001;
  assert.equal(limiter.take('a'), true);
});

// ---------------------------------------------------------------------------
// Who can reach whom
// ---------------------------------------------------------------------------

test('the public-listing and reachable-agent gates are the storefront\'s own', () => {
  assert.equal(CHAT_PUBLIC_LISTING_FILTER, 'p.status = 1 AND p.approve_status = 1');
  assert.ok(listingsSource.includes(`const APPROVED_FILTER = '${CHAT_PUBLIC_LISTING_FILTER}'`));
  assert.ok(
    listingsSource.includes('a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS NOT FALSE'),
    'the listing page shows an agent number under exactly this rule',
  );
  assert.ok(CHAT_REACHABLE_AGENT_FILTER.includes('a.phone_verified_at IS NOT NULL AND a.direct_routing_enabled IS NOT FALSE'));
  assert.ok(CHAT_REACHABLE_AGENT_FILTER.includes('a.deleted_at IS NULL'));
});

test('a customer whose phone is not verified cannot open a conversation', async () => {
  enqueue([{ phone: '243811111111', phone_verified_at: null }]);
  const result = await startThread(11, { propertyId: 5, body: 'Bonjour' });
  assert.equal(result.status, 'phone-unverified');
  assert.equal(calls.length, 1);
});

test('from a listing, the agent is the listing\'s own and the listing must be public', async () => {
  enqueue([{ phone: '243811111111', phone_verified_at: '2026-10-01' }]);
  enqueue([]); // no public listing with a reachable agent
  const result = await startThread(11, { propertyId: 5, agentId: 99, body: 'Bonjour' });
  assert.equal(result.status, 'listing-unavailable');
  const lookup = calls[1];
  assert.ok(lookup.sql.includes('JOIN agents a ON a.id = p.agent_id'));
  assert.ok(lookup.sql.includes(CHAT_PUBLIC_LISTING_FILTER));
  assert.ok(lookup.sql.includes(CHAT_REACHABLE_AGENT_FILTER));
  assert.deepEqual(lookup.values, [5], 'the agentId in the request is never read when there is a listing');
});

test('nobody writes to themselves', async () => {
  enqueue([{ phone: '243811111111', phone_verified_at: '2026-10-01' }]);
  enqueue([{ id: 7, phone: '+243 811 111 111' }]);
  assert.equal((await startThread(11, { propertyId: 5, body: 'Bonjour' })).status, 'self');
});

test('the daily cap on new conversations is enforced in the INSERT itself', async () => {
  enqueue([{ phone: '243811111111', phone_verified_at: '2026-10-01' }]);
  enqueue([{ id: 7, phone: '243899999999' }]);
  enqueue([]); // no existing thread
  enqueue([]); // the guarded INSERT inserted nothing
  const result = await startThread(11, { propertyId: 5, body: 'Bonjour' });
  assert.equal(result.status, 'limit');
  const insert = calls[3];
  assert.ok(insert.sql.includes("created_at > NOW() - INTERVAL '1 day') < $4"));
  assert.ok(insert.sql.includes('ON CONFLICT (customer_id, agent_id, (COALESCE(property_id, 0)))'));
  assert.ok(migration.includes('ON chat_threads (customer_id, agent_id, (COALESCE(property_id, 0)))'), 'the conflict target is the unique index');
});

test('a new conversation is created and its first message sent as the customer', async () => {
  enqueue([{ phone: '243811111111', phone_verified_at: '2026-10-01' }]);
  enqueue([{ id: 7, phone: '243899999999' }]);
  enqueue([]); // no existing thread
  enqueue([{ id: 55, created: true }]);
  enqueue([]); // BEGIN
  enqueue([{ id: 55, blocked_at: null }]); // FOR UPDATE
  enqueue([MESSAGE_ROW({ id: 900 })]); // INSERT
  const result = await startThread(31, { propertyId: 5, body: '  Est-il libre ?  ' });
  assert.equal(result.status, 'ok');
  assert.equal(result.threadId, 55);
  assert.equal(result.created, true);
  const insert = calls.find((c) => c.sql.startsWith('INSERT INTO chat_messages'));
  assert.deepEqual(insert.values.slice(0, 4), [55, 'customer', 'text', 'Est-il libre ?']);
});

// ---------------------------------------------------------------------------
// Every read is the viewer's own
// ---------------------------------------------------------------------------

test('the inbox lists only the viewer\'s side, with no empty threads', async () => {
  await listThreads(customer(11), {});
  assert.ok(calls[0].sql.includes('WHERE t.customer_id = $1 AND t.last_message_id IS NOT NULL'));
  assert.equal(calls[0].values[0], 11);
  assert.equal(calls[0].values[1], 'customer');

  reset();
  await listThreads(agent(7), { filter: 'archived' });
  assert.ok(calls[0].sql.includes('WHERE t.agent_id = $1'));
  assert.ok(!calls[0].sql.includes('t.customer_id = $1'));
  assert.ok(calls[0].sql.includes('t.agent_archived_at IS NOT NULL'));
  assert.ok(calls[0].sql.includes('m.id > t.agent_last_read_id'), 'unread counts the agent\'s own read position');
});

test('a thread is read only through its own side', async () => {
  const thread = await getThread(customer(11), 55);
  assert.equal(thread, null);
  assert.ok(calls[0].sql.includes('WHERE t.customer_id = $1 AND t.id = $3'));
  assert.deepEqual(calls[0].values, [11, 'customer', 55]);
});

test('messages of a thread that is not the viewer\'s are never queried', async () => {
  enqueue([]); // access check finds nothing
  assert.equal(await listMessages(agent(7), 55, {}), null);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes('t.agent_id = $2'));
});

test('a poll returns what is newer, oldest first', async () => {
  enqueue([{ id: 55 }]);
  enqueue([MESSAGE_ROW({ id: 102 }), MESSAGE_ROW({ id: 103 })]);
  const page = await listMessages(customer(11), 55, { after: '101' });
  assert.deepEqual(page.messages.map((m) => m.id), [102, 103]);
  assert.ok(calls[1].sql.includes('AND m.id > $3'));
  assert.ok(calls[1].sql.includes('ORDER BY m.id ASC'));
});

test('read, block and report are scoped to the viewer\'s side too', async () => {
  await markRead(customer(11), 55, 120);
  assert.ok(calls[0].sql.includes('GREATEST(t.customer_last_read_id, LEAST($3::bigint, COALESCE(t.last_message_id, 0)))'));
  assert.ok(calls[0].sql.includes('WHERE t.id = $1 AND t.customer_id = $2'));

  reset();
  enqueue([]); // UPDATE matched nothing
  enqueue([]); // getThread: not the viewer's
  assert.equal((await setBlocked(agent(7), 55, false)).status, 'not-found');
  assert.ok(calls[0].sql.includes('t.blocked_by = $3'), 'only the side that blocked can lift it');

  reset();
  enqueue([]); // access check
  assert.equal((await reportThread(agent(7), 55, { reason: 'scam' })).status, 'not-found');
  assert.equal(calls.length, 1);
  assert.equal((await reportThread(agent(7), 55, { reason: 'because' })).status, 'invalid-reason');
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

test('a blocked thread takes no new message', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 55, blocked_at: '2026-11-05T09:00:00Z' }]);
  const result = await sendMessage(agent(201), 55, { body: 'Bonjour' });
  assert.equal(result.status, 'blocked');
  assert.ok(!calls.some((c) => c.sql.startsWith('INSERT')));
  assert.ok(calls.some((c) => c.sql === 'ROLLBACK'));
});

test('a retried message is returned, not posted twice', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 55, blocked_at: null }]);
  enqueue([MESSAGE_ROW({ id: 900, client_id: '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f' })]);
  const result = await sendMessage(customer(202), 55, { body: 'Bonjour', clientId: '6F1C2D3E-4A5B-4C6D-8E9F-0A1B2C3D4E5F' });
  assert.equal(result.status, 'ok');
  assert.equal(result.duplicate, true);
  assert.equal(result.message.id, 900);
  assert.ok(!calls.some((c) => c.sql.startsWith('INSERT')));
});

test('sending moves the thread forward and marks it read for the sender', async () => {
  enqueue([]); // BEGIN
  enqueue([{ id: 55, blocked_at: null }]);
  enqueue([MESSAGE_ROW({ id: 901, sender_role: 'agent' })]);
  const result = await sendMessage(agent(203), 55, { body: 'Oui, il est libre.' });
  assert.equal(result.status, 'ok');
  const lock = calls[1];
  assert.ok(lock.sql.includes('t.agent_id = $2 FOR UPDATE'));
  const update = calls.find((c) => c.sql.startsWith('UPDATE chat_threads'));
  assert.ok(update.sql.includes('agent_last_read_id = GREATEST(agent_last_read_id, $2)'));
  assert.ok(update.sql.includes("CASE WHEN $5 = 'agent' THEN COALESCE(agent_first_reply_at, $3)"));
  assert.equal(update.values[4], 'agent');
  assert.ok(calls.some((c) => c.sql === 'COMMIT'));
});

test('only agents share listings, and only their own public ones', async () => {
  assert.equal((await sendMessage(customer(204), 55, { kind: 'listing', propertyId: 5 })).status, 'invalid-kind');
  assert.equal(calls.length, 0);

  enqueue([]); // BEGIN
  enqueue([{ id: 55, blocked_at: null }]);
  enqueue([]); // not the agent's own public listing
  const result = await sendMessage(agent(205), 55, { kind: 'listing', propertyId: 5 });
  assert.equal(result.status, 'listing-unavailable');
  const own = calls[2];
  assert.ok(own.sql.includes('p.agent_id = $2'));
  assert.ok(own.sql.includes(CHAT_PUBLIC_LISTING_FILTER));
  assert.deepEqual(own.values, [5, 205]);
});

test('an account sends at most the per-minute limit', async () => {
  const viewer = customer(206);
  for (let i = 0; i < CHAT_SEND_PER_MINUTE; i += 1) {
    assert.equal((await sendMessage(viewer, 55, { body: 'x' })).status, 'not-found');
  }
  assert.equal((await sendMessage(viewer, 55, { body: 'x' })).status, 'rate-limited');
});

// ---------------------------------------------------------------------------
// The routes' plumbing
// ---------------------------------------------------------------------------

test('only a JSON body is read, so a cross-site form cannot write', async () => {
  const form = new Request('https://lukkaplace.com/api/chat/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'body=hello',
  });
  assert.equal(await readChatJson(form), null);
  const json = new Request('https://lukkaplace.com/api/chat/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: 'hello' }),
  });
  assert.deepEqual(await readChatJson(json), { body: 'hello' });
});

test('every status lib/chat.js returns has an HTTP code', () => {
  for (const status of ['ok', 'not-found', 'blocked', 'rate-limited', 'limit', 'phone-unverified', 'listing-unavailable',
    'agent-unavailable', 'self', 'empty', 'too-long', 'invalid-kind', 'invalid-reason', 'forbidden', 'unavailable']) {
    assert.ok(CHAT_STATUS_HTTP[status], status);
  }
  assert.equal(CHAT_STATUS_HTTP['not-found'], 404);
  assert.equal(CHAT_STATUS_HTTP.unavailable, 503);
});

test('the tables start closed to the public API', () => {
  for (const table of ['chat_threads', 'chat_messages', 'chat_reports']) {
    assert.ok(migration.includes(`ALTER TABLE ${table}`), table);
  }
  assert.ok(migration.includes("EXECUTE format('REVOKE ALL ON %I FROM %I', tbl, role_name)"));
});

// ---------------------------------------------------------------------------
// Phase 2: the screens' helpers
// ---------------------------------------------------------------------------

test('"Envoyer un message" shows exactly where the first message would be accepted', () => {
  assert.equal(canMessageListing({ id: 5, agent_id: 7, agent_phone: '243811111111' }), true);
  assert.equal(canMessageListing({ id: 5, agent_id: 7, agent_phone: null }), false, 'lib/listings.js nulls agent_phone for an unverified or routing-off agent');
  assert.equal(canMessageListing({ id: 5, agent_id: null, agent_phone: '243811111111' }), false);
  assert.equal(chatStartHref({ propertyId: 5 }), '/messages/nouveau?listing=5');
  assert.equal(chatStartHref({ agentId: 7 }), '/messages/nouveau?agent=7');
  assert.equal(chatStartHref({}), '/messages');
});

test('times are on Kinshasa time, so server and browser print the same', () => {
  const t = (key) => ({ 'chat.time.today': "Aujourd'hui", 'chat.time.yesterday': 'Hier', 'chat.time.yesterdayShort': 'hier' })[key] || key;
  // 23:30 UTC on the 4th is 00:30 on the 5th in Kinshasa (UTC+1).
  assert.equal(chatDayKey('2026-11-04T23:30:00Z'), '2026-11-05');
  assert.equal(chatClock('2026-11-04T23:30:00Z', 'fr'), '00:30');
  const now = '2026-11-05T10:00:00Z';
  assert.equal(chatDayLabel('2026-11-04T23:30:00Z', now, 'fr', t), "Aujourd'hui");
  assert.equal(chatDayLabel('2026-11-04T12:00:00Z', now, 'fr', t), 'Hier');
  assert.match(chatDayLabel('2026-11-02T12:00:00Z', now, 'fr', t), /^lundi 2 novembre$/);
  assert.match(chatDayLabel('2025-11-02T12:00:00Z', now, 'fr', t), /2025/);
  assert.equal(chatInboxTime('2026-11-05T09:42:00Z', now, 'fr', t), '10:42');
  assert.equal(chatInboxTime('2026-11-04T09:42:00Z', now, 'fr', t), 'hier');
  assert.match(chatInboxTime('2026-11-02T09:42:00Z', now, 'fr', t), /^lun\.?$/);
  assert.match(chatInboxTime('2026-10-28T09:42:00Z', now, 'fr', t), /^28 oct\.?$/);
});

test('the first-message screen reads the agent with the same gates as startThread', async () => {
  await getChatTarget({ propertyId: 5, agentId: 99 });
  assert.ok(calls[0].sql.includes('JOIN agents a ON a.id = p.agent_id'));
  assert.ok(calls[0].sql.includes(CHAT_PUBLIC_LISTING_FILTER));
  assert.ok(calls[0].sql.includes(CHAT_REACHABLE_AGENT_FILTER));
  assert.deepEqual(calls[0].values, [5], 'with a listing, the agent id in the URL is ignored');

  reset();
  assert.equal(await getChatTarget({ agentId: 7 }), null);
  assert.ok(calls[0].sql.includes('WHERE a.id = $1 AND ' + CHAT_REACHABLE_AGENT_FILTER));

  reset();
  assert.equal(await getChatTarget({}), null);
  assert.equal(calls.length, 0);
});

test('an existing conversation is reopened only when it has a message', async () => {
  await findCustomerThreadId(11, 7, 5);
  assert.ok(calls[0].sql.includes('customer_id = $1 AND agent_id = $2'));
  assert.ok(calls[0].sql.includes('last_message_id IS NOT NULL'));
  assert.deepEqual(calls[0].values, [11, 7, 5]);
});

test('the listing page and the agent profile link to the chat only through the shared rule', () => {
  const read = (rel) => readFileSync(path.join(WEB_ROOT, rel), 'utf8');
  for (const file of ['components/EnquiryCard.js', 'components/MobileListingBar.js']) {
    const source = read(file);
    assert.ok(source.includes('canMessageListing(listing)'), file);
    assert.ok(source.includes('chatStartHref({ propertyId'), file);
  }
  const profile = read('app/(portfolio)/agents/[id]/page.js');
  assert.ok(profile.includes('messageHref: routablePhone ? chatStartHref({ agentId: agent.id }) : null'));
});

test('a conversation page has no site footer; the inbox keeps the compact one', () => {
  const footer = readFileSync(path.join(WEB_ROOT, 'components', 'Footer.js'), 'utf8');
  assert.ok(footer.includes("const ACCOUNT_FOOTER_PATHS = ['/compte/client', '/messages'];"));
  assert.ok(footer.includes("const NO_FOOTER_UNDER = ['/messages'];"));
  assert.ok(footer.includes('empty:hidden'), 'an empty <footer> must not leave its border and padding behind');
});

// ---------------------------------------------------------------------------
// Phase 3: the agent's side
// ---------------------------------------------------------------------------

test('"Partager un bien" offers only the agent’s own public listings', async () => {
  await listShareableListings(7);
  assert.ok(calls[0].sql.includes('WHERE p.agent_id = $1 AND ' + CHAT_PUBLIC_LISTING_FILTER));
  assert.equal(calls[0].values[0], 7);
  reset();
  assert.deepEqual(await listShareableListings(null), []);
  assert.equal(calls.length, 0);
});

test('an agent sees the customer as first name and initial, with no phone', async () => {
  enqueue([{
    id: 55, customer_id: 11, agent_id: 7, property_id: null, last_message_id: 9, last_message_at: '2026-11-05T09:00:00Z',
    customer_name: 'Grace Kabila', customer_since: '2026-10-02T08:00:00Z', customer_verified: true, unread: 1,
  }]);
  const thread = await getThread(agent(7), 55);
  assert.equal(thread.counterpart.role, 'customer');
  assert.equal(thread.counterpart.name, 'Grace K.');
  assert.equal(thread.counterpart.since, '2026-10-02T08:00:00.000Z');
  assert.ok(!('phone' in thread.counterpart));
  assert.ok(!calls[0].sql.includes('c.phone '), 'the customer’s number is never selected for the agent');
});

test('the waiting chip reads minutes, hours, then days', () => {
  const now = '2026-11-05T12:00:00Z';
  assert.equal(chatWaitLabel('2026-11-05T11:48:00Z', now), '12 min');
  assert.equal(chatWaitLabel('2026-11-05T11:59:50Z', now), '1 min');
  assert.equal(chatWaitLabel('2026-11-05T09:30:00Z', now), '2 h');
  assert.equal(chatWaitLabel('2026-11-02T09:00:00Z', now, 'fr'), '3 j');
  assert.equal(chatWaitLabel('2026-11-02T09:00:00Z', now, 'en'), '3 d');
});

test('the agent portal carries Messages with its unread count, and the chat copy', () => {
  const read = (rel) => readFileSync(path.join(WEB_ROOT, rel), 'utf8');
  const sidebar = read('components/AgentSidebar.js');
  assert.ok(sidebar.includes("href: '/compte/agent/messages'"));
  assert.ok(sidebar.includes("countKey: 'messages'"));
  const layout = read('app/compte/agent/layout.js');
  assert.ok(layout.includes("countUnreadThreads({ role: 'agent', id: agentId })"));
  assert.ok(/AGENT_NAMESPACES = \[[^\]]*'chat'/.test(layout), 'the agent screens render chat.* strings');
});
