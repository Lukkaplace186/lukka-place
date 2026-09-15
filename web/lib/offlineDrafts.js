/**
 * Offline drafts for the agent's "Ajouter un bien" form — IndexedDB, browser
 * only, no dependency.
 *
 * WHY IndexedDB AND NOT localStorage
 * The draft carries the photos, and a phone photo is 2-10 MB. localStorage is
 * a ~5 MB string store per origin; IndexedDB stores Blobs natively and is
 * sized to the device. Fields alone would fit in localStorage, but a draft that
 * restores the text and silently loses the six photos taken on site is the
 * failure this exists to prevent.
 *
 * WHAT IT IS NOT
 * Not a service worker and not Background Sync: a queued submission is sent
 * when the agent's dashboard is open and the connection comes back, by the
 * page itself (CreateListingDialog). A page closed while offline keeps the
 * draft and sends it the next time Mes biens is opened online.
 *
 * Every entry point swallows storage failures (private mode, quota, a browser
 * with IndexedDB disabled) and reports "no draft": the form must work exactly
 * as before when there is nowhere to save.
 *
 * Keys are per agent (`agent:<id>:new-listing`), so two agents sharing one
 * phone never restore each other's drafts.
 */

const DB_NAME = 'lukka-agent-drafts';
const DB_VERSION = 1;
const STORE = 'drafts';

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
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function newListingDraftKey(agentId) {
  return `agent:${agentId}:new-listing`;
}

/**
 * @typedef {{fields: Record<string,string>, photos: Array<{name: string, type: string, blob: Blob}>,
 *            queued: boolean, updatedAt: number}} ListingDraft
 * @returns {Promise<ListingDraft|null>}
 */
export async function loadDraft(key) {
  try {
    const draft = await withStore('readonly', (store) => store.get(key));
    return draft && typeof draft === 'object' ? draft : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<boolean>} whether it was actually stored */
export async function saveDraft(key, draft) {
  try {
    await withStore('readwrite', (store) => store.put({ ...draft, updatedAt: Date.now() }, key));
    return true;
  } catch {
    return false;
  }
}

export async function deleteDraft(key) {
  try {
    await withStore('readwrite', (store) => store.delete(key));
  } catch {
    // Nothing stored, nothing to delete.
  }
}

/** Text fields worth keeping from the form — never the file input. */
export function fieldsFromForm(form) {
  const fields = {};
  if (!form) return fields;
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value === 'string' && name !== 'photos') fields[name] = value;
  }
  return fields;
}

export function isEmptyDraft(draft) {
  if (!draft) return true;
  const hasText = Object.values(draft.fields || {}).some((v) => String(v).trim() !== '');
  return !hasText && !(draft.photos || []).length;
}

/**
 * A failure that means "the network is gone", as opposed to a server verdict.
 * A Server Action that cannot reach the server rejects with a TypeError
 * ("Failed to fetch" / "Load failed" / "NetworkError…"), and navigator.onLine
 * is the browser's own, if optimistic, opinion.
 */
export function looksOffline(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return err instanceof TypeError && /fetch|network|load failed/i.test(String(err.message));
}
