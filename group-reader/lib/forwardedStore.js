/**
 * Message ids already handed to the engine (or refused by it), on disk, so a
 * restart — and WhatsApp re-delivering the offline backlog on reconnect —
 * never sends the same post twice. Bounded: the oldest ids fall off past
 * `max`, which is far more than a reconnect can ever re-deliver.
 */

'use strict';

const fs = require('fs');
const path = require('path');

class ForwardedStore {
  constructor(file, { max = 20_000 } = {}) {
    this.file = file;
    this.max = max;
    this.ids = new Map(); // id -> epoch ms
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [id, at] of Object.entries(saved.ids || {})) this.ids.set(id, at);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[group-reader] could not read ${file}, starting empty: ${err.message}`);
    }
  }

  has(id) {
    return this.ids.has(id);
  }

  addAll(ids) {
    const now = Date.now();
    for (const id of ids) this.ids.set(id, now);
    while (this.ids.size > this.max) this.ids.delete(this.ids.keys().next().value);
    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ids: Object.fromEntries(this.ids) }));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { ForwardedStore };
