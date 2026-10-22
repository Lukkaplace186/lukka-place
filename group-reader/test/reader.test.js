'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { shouldForward, standsAloneAsListing } = require('../lib/prefilter');
const { Batcher } = require('../lib/batcher');
const { ForwardedStore } = require('../lib/forwardedStore');
const { postGroupPost } = require('../lib/forwarder');
const { isWatchedGroup, authorOf, phoneOf, contentOf, photoFileName } = require('../lib/messages');

test('prefilter: a listing with a property and a price goes through', () => {
  assert.equal(shouldForward({ text: 'Appartement 2 chambres à louer à Limete, 800$ / mois', photoCount: 0 }), true);
  assert.equal(shouldForward({ text: 'Offre de location : villa à Ngaliema. Loyer : 2 500', photoCount: 0 }), true);
  assert.equal(shouldForward({ text: 'À vendre parcelle 20x30 à Kimbanseke prix 35.000 USD', photoCount: 0 }), true);
});

test('prefilter: chatter is dropped', () => {
  assert.equal(shouldForward({ text: 'Bonjour la famille, bonne journée à tous', photoCount: 0 }), false);
  assert.equal(shouldForward({ text: 'Toujours disponible ?', photoCount: 0 }), false);
  assert.equal(shouldForward({ text: 'Je cherche un appartement à Gombe pour un client', photoCount: 0 }), false); // no price
  assert.equal(shouldForward({ text: 'Merci pour les 500$ hier, reçu cher frère', photoCount: 0 }), false); // no property
  assert.equal(shouldForward({ text: 'appart 500$', photoCount: 0 }), false); // too short to be a description
  assert.equal(shouldForward({ text: '', photoCount: 0 }), false);
});

test('prefilter: any photo goes through', () => {
  assert.equal(shouldForward({ text: '', photoCount: 1 }), true);
  assert.equal(shouldForward({ text: 'Bonjour', photoCount: 3 }), true);
});

test('prefilter: accents and case are folded', () => {
  assert.equal(standsAloneAsListing('ENTREPÔT À LOUER À LIMETE INDUSTRIEL, 3 000 $'), true);
});

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        await next[1].fn();
      }
      now = target;
    },
  };
}

function makeBatcher() {
  const timers = fakeTimers();
  const flushed = [];
  const batcher = new Batcher({ onFlush: (b) => { flushed.push(b); }, timers });
  return { batcher, timers, flushed };
}

const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';

test('batcher: one author\'s burst is flushed once, after 10 s of quiet', async () => {
  const { batcher, timers, flushed } = makeBatcher();
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm1', photo: Promise.resolve('/uploads/listings/grp_m1-0.jpg') });
  await timers.advance(4_000);
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm2', photo: Promise.resolve('/uploads/listings/grp_m2-0.jpg') });
  await timers.advance(4_000);
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm3', text: 'Villa à louer 1500$', meta: { posterName: 'Jean', posterPhone: '243810000000' } });
  await timers.advance(9_999);
  assert.equal(flushed.length, 0);
  await timers.advance(1);
  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0].wamids, ['m1', 'm2', 'm3']);
  assert.deepEqual(flushed[0].photos, ['/uploads/listings/grp_m1-0.jpg', '/uploads/listings/grp_m2-0.jpg']);
  assert.equal(flushed[0].text, 'Villa à louer 1500$');
  assert.equal(flushed[0].posterName, 'Jean');
  assert.equal(flushed[0].posterPhone, '243810000000');
  assert.equal(batcher.size, 0);
});

test('batcher: authors and groups never share a batch', async () => {
  const { batcher, timers, flushed } = makeBatcher();
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm1', text: 'A' });
  batcher.add({ groupJid: G1, author: 'b@lid', messageId: 'm2', text: 'B' });
  batcher.add({ groupJid: G2, author: 'a@lid', messageId: 'm3', text: 'C' });
  await timers.advance(10_000);
  assert.equal(flushed.length, 3);
  assert.deepEqual(flushed.map((b) => b.text).sort(), ['A', 'B', 'C']);
});

test('batcher: a non-stop poster is cut at 60 s', async () => {
  const { batcher, timers, flushed } = makeBatcher();
  for (let i = 0; i < 10; i += 1) {
    batcher.add({ groupJid: G1, author: 'a@lid', messageId: `m${i}`, text: `part ${i}` });
    await timers.advance(8_000); // never 10 s of quiet
  }
  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0].wamids, ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']); // added at 0..56 s
  await timers.advance(10_000);
  assert.equal(flushed.length, 2);
  assert.deepEqual(flushed[1].wamids, ['m8', 'm9']);
});

test('batcher: a repeated message id is counted once, a failed photo is dropped', async () => {
  const { batcher, timers, flushed } = makeBatcher();
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm1', text: 'x' });
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm1', text: 'x' });
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm2', photo: Promise.resolve(null) });
  batcher.add({ groupJid: G1, author: 'a@lid', messageId: 'm3', photo: Promise.reject(new Error('expired')) });
  await timers.advance(10_000);
  assert.deepEqual(flushed[0].wamids, ['m1', 'm2', 'm3']);
  assert.equal(flushed[0].text, 'x');
  assert.deepEqual(flushed[0].photos, []);
});

test('messages: only listed groups are read', () => {
  const watched = new Set([G1]);
  assert.equal(isWatchedGroup(G1, watched), true);
  assert.equal(isWatchedGroup(G2, watched), false);
  assert.equal(isWatchedGroup('243810000000@s.whatsapp.net', watched), false);
  assert.equal(isWatchedGroup('status@broadcast', watched), false);
  assert.equal(isWatchedGroup(undefined, watched), false);
});

test('messages: poster phone comes from a phone jid, never from a LID', () => {
  assert.equal(phoneOf({ participant: '243810000000@s.whatsapp.net' }), '243810000000');
  assert.equal(phoneOf({ participant: '123456789012345@lid', participantAlt: '243820000000@s.whatsapp.net' }), '243820000000');
  assert.equal(phoneOf({ participant: '243830000000:12@s.whatsapp.net' }), '243830000000');
  assert.equal(phoneOf({ participant: '123456789012345@lid' }), null);
  assert.equal(authorOf({ participant: '123456789012345@lid' }), '123456789012345@lid');
});

test('messages: text and image are read from captions too; file names are safe', () => {
  assert.deepEqual(contentOf({ conversation: 'salut' }), { text: 'salut', image: null });
  assert.equal(contentOf({ extendedTextMessage: { text: 'lien' } }).text, 'lien');
  const img = { caption: 'Villa 1500$', mimetype: 'image/jpeg' };
  assert.deepEqual(contentOf({ imageMessage: img }), { text: 'Villa 1500$', image: img });
  assert.deepEqual(contentOf(undefined), { text: '', image: null });
  assert.equal(photoFileName('3EB0+AB=C.D', 0, 'image/jpeg'), 'grp_3EB0_AB_C_D-0.jpg');
  assert.equal(photoFileName('X', 1), 'grp_X-1.jpg');
});

test('forwarded store survives a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grp-')), 'forwarded.json');
  const a = new ForwardedStore(file);
  a.addAll(['m1', 'm2']);
  const b = new ForwardedStore(file);
  assert.equal(b.has('m1'), true);
  assert.equal(b.has('m3'), false);
  const small = new ForwardedStore(file, { max: 2 });
  small.addAll(['m3']);
  assert.equal(small.has('m1'), false);
  assert.equal(small.has('m3'), true);
});

const quiet = { log() {}, warn() {}, error() {} };
const payload = { via: 'reader', groupJid: G1, groupName: 'G', posterPhone: null, posterName: 'J', text: 't', photos: [], wamids: ['m1'] };

test('forwarder: retries 5xx and network errors, drops 4xx', async () => {
  const calls = [];
  const responses = [new Error('ECONNREFUSED'), { status: 502 }, { status: 200 }];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status < 300, status: r.status, text: async () => '' };
  };
  const result = await postGroupPost(payload, { engineUrl: 'http://engine/', apiKey: 'k', fetchImpl, sleep: async () => {}, log: quiet });
  assert.equal(result, 'sent');
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'http://engine/internal/group-posts');
  assert.equal(calls[0].init.headers['x-api-key'], 'k');
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);

  let n = 0;
  const refused = await postGroupPost(payload, {
    engineUrl: 'http://engine', apiKey: 'k', sleep: async () => {}, log: quiet,
    fetchImpl: async () => { n += 1; return { ok: false, status: 422, text: async () => 'bad' }; },
  });
  assert.equal(refused, 'refused');
  assert.equal(n, 1);

  const failed = await postGroupPost(payload, {
    engineUrl: 'http://engine', apiKey: 'k', sleep: async () => {}, log: quiet, maxAttempts: 3,
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  });
  assert.equal(failed, 'failed');
});
