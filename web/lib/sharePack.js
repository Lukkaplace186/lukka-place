'use client';

/**
 * The share kit's offline copy — IndexedDB, browser only, no dependency.
 *
 * When the agent opens "Visuel & partage" online, the dialog stores what the
 * server sent (captions + the share pack, lib/marketing/sharePackData.js) AND
 * the image bytes it downloaded (photos, logo, the Lukka Place mark). Opening
 * the dialog again with no connection draws every format from that copy.
 *
 * AN OFFLINE FLYER CAN BE WRONG, SO IT SAYS SO
 * The server flyer was rendered on demand precisely because a cached graphic
 * showing last week's price is a graphic that lies. An offline copy cannot
 * avoid that, so the dialog always shows when the copy was taken, and warns
 * once it is older than STALE_AFTER_MS. The record keeps the server's own
 * `fetchedAt`, not the time the bytes finished downloading.
 *
 * A separate database from lib/offlineDrafts.js's rather than a second store
 * in it: adding a store means bumping that database's version, and a tab still
 * open on the old version would block the upgrade for the draft form too.
 *
 * Every entry point swallows storage failures (private mode, quota, IndexedDB
 * disabled): the kit must work online exactly as before when there is nowhere
 * to save.
 */

const DB_NAME = 'lukka-share-packs';
const DB_VERSION = 1;
const STORE = 'packs';

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const packKey = (listingId) => `listing:${Number(listingId)}`;

/**
 * @param {number} listingId
 * @param {{kit: object, photos: Blob[], logo: Blob|null, mark: Blob|null}} record
 */
export async function saveSharePack(listingId, record) {
  try {
    await withStore('readwrite', (store) => store.put({ ...record, savedAt: Date.now() }, packKey(listingId)));
    return true;
  } catch {
    return false;
  }
}

/** @returns {Promise<{kit, photos, logo, mark, savedAt}|null>} */
export async function loadSharePack(listingId) {
  try {
    const record = await withStore('readonly', (store) => store.get(packKey(listingId)));
    return record?.kit?.pack ? record : null;
  } catch {
    return null;
  }
}

async function fetchBlob(url, signal) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return null;
  }
}

/**
 * Downloads the pack's images. A photo that fails is dropped, not retried —
 * the pack lists spares and the layout adapts to however many arrived.
 */
export async function fetchPackImages(pack, { signal } = {}) {
  const [photos, logo, mark] = await Promise.all([
    Promise.all((pack.photos || []).map((url) => fetchBlob(url, signal))),
    fetchBlob(pack.agent?.logo, signal),
    fetchBlob(pack.mark, signal),
  ]);
  return { photos: photos.filter(Boolean), logo, mark };
}

export function packTimestamp(kit) {
  const fetched = Date.parse(kit?.pack?.fetchedAt || '');
  return Number.isNaN(fetched) ? null : fetched;
}

export function isStale(timestamp, now = Date.now()) {
  return timestamp != null && now - timestamp > STALE_AFTER_MS;
}
