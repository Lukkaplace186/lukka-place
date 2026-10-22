/**
 * Per (group, author) burst buffer — the group counterpart of the engine's
 * webhook buffer. A broker posts a listing as several messages (photos one by
 * one, the text before or after); they are held until the author has been
 * quiet for `quietMs`, or `capMs` after the first one, whichever comes first,
 * and then handed to `onFlush` as one batch.
 *
 * Photo downloads start the moment a message arrives (WhatsApp media URLs
 * expire), so an item may carry a `photo` promise; the flush awaits them all.
 * Timers are injectable so the tests run without real time.
 */

'use strict';

const DEFAULT_QUIET_MS = 10_000;
const DEFAULT_CAP_MS = 60_000;

class Batcher {
  /**
   * @param {Object} opts
   * @param {(batch: Object) => Promise<void>|void} opts.onFlush
   * @param {number} [opts.quietMs]
   * @param {number} [opts.capMs]
   * @param {{setTimeout: Function, clearTimeout: Function}} [opts.timers]
   */
  constructor({ onFlush, quietMs = DEFAULT_QUIET_MS, capMs = DEFAULT_CAP_MS, timers = globalThis }) {
    this.onFlush = onFlush;
    this.quietMs = quietMs;
    this.capMs = capMs;
    this.timers = timers;
    this.buffers = new Map();
  }

  static keyOf(groupJid, author) {
    return `${groupJid}|${author}`;
  }

  /**
   * @param {Object} item
   * @param {string} item.groupJid
   * @param {string} item.author        Stable author id (participant jid).
   * @param {string} item.messageId
   * @param {string} [item.text]
   * @param {Promise<string|null>} [item.photo]  Resolves to a web path, or null on failure.
   * @param {Object} [item.meta]        posterPhone, posterName, groupName — last non-empty wins.
   */
  add(item) {
    const key = Batcher.keyOf(item.groupJid, item.author);
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = {
        key,
        groupJid: item.groupJid,
        author: item.author,
        meta: {},
        texts: [],
        photos: [],
        messageIds: [],
        quietTimer: null,
        capTimer: this.timers.setTimeout(() => this.flush(key), this.capMs),
      };
      this.buffers.set(key, buf);
    }
    if (buf.messageIds.includes(item.messageId)) return;
    buf.messageIds.push(item.messageId);
    const text = String(item.text || '').trim();
    if (text) buf.texts.push(text);
    if (item.photo) buf.photos.push(item.photo);
    for (const [k, v] of Object.entries(item.meta || {})) {
      if (v) buf.meta[k] = v;
    }
    if (buf.quietTimer) this.timers.clearTimeout(buf.quietTimer);
    buf.quietTimer = this.timers.setTimeout(() => this.flush(key), this.quietMs);
  }

  /** Flush one buffer now. Resolves once onFlush has finished. */
  async flush(key) {
    const buf = this.buffers.get(key);
    if (!buf) return;
    this.buffers.delete(key);
    this.timers.clearTimeout(buf.quietTimer);
    this.timers.clearTimeout(buf.capTimer);
    const photos = (await Promise.all(buf.photos.map((p) => Promise.resolve(p).catch(() => null))))
      .filter(Boolean);
    await this.onFlush({
      groupJid: buf.groupJid,
      author: buf.author,
      ...buf.meta,
      text: buf.texts.join('\n\n'),
      photos,
      wamids: buf.messageIds,
    });
  }

  /** Flush everything (shutdown). */
  async flushAll() {
    await Promise.all([...this.buffers.keys()].map((key) => this.flush(key)));
  }

  get size() {
    return this.buffers.size;
  }
}

module.exports = { Batcher, DEFAULT_QUIET_MS, DEFAULT_CAP_MS };
