/**
 * The upload ceilings, in ONE file, because three separate layers have to
 * agree on them and a disagreement between them is silent and total:
 *
 *  1. the browser  — pre-flight check, before a single byte is sent;
 *  2. the Server Action — the authoritative validation;
 *  3. next.config.mjs — the transport ceiling Next.js puts on a Server
 *     Action request body.
 *
 * Layer 3 is the one that broke manual submissions. Next.js caps a Server
 * Action body at **1 MB by default**, and this app never configured it. So
 * the action validated photos at 5 MB each while the transport aborted the
 * request at 1 MB with a 413 — *before* any of that validation ran, before
 * `assertAgentSession`, before anything. Production `pm2-error.log` carries
 * the proof ("Body exceeded 1 MB limit.", statusCode 413, two distinct
 * action digests). Since a phone photo is routinely 2-5 MB, every realistic
 * manual submission failed, while WhatsApp intake kept working because it
 * reaches the engine over a plain Express route and never touches a Server
 * Action.
 *
 * It presented as a dead button rather than an error because a 413 is a
 * *transport* failure: the client's `await createListingAction(...)` rejects
 * with a TypeError ("Failed to fetch"), it is not an `{ ok: false }` the
 * caller could show. See the try/catch in CreateListingDialog.
 *
 * **No imports, and nothing server-only, on purpose**: next.config.mjs is
 * loaded by plain Node ESM with no bundler, so it can resolve neither the
 * `@/…` alias nor anything that reaches for `server-only`. The `.mjs`
 * extension is for the same reason — package.json has no `"type": "module"`,
 * so a `.js` file with `export` in it makes Node print a
 * MODULE_TYPELESS_PACKAGE_JSON reparse warning on every single start.
 */

/** Photos per listing. */
export const MAX_LISTING_PHOTOS = 10;

/** One photo. The `errors.photoTooLarge` copy quotes this figure. */
export const MAX_LISTING_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * Every photo in ONE submission, added together — deliberately far below
 * MAX_LISTING_PHOTOS × MAX_LISTING_PHOTO_BYTES (50 MB).
 *
 * A per-file cap alone cannot bound the request, and the request is what
 * has a ceiling. 20 MB covers the real case (10 photos averaging 2 MB, or
 * 4 large ones straight off a phone) without asking an agent on a Kinshasa
 * mobile connection to push 50 MB up a single request that has to survive
 * to completion. Over it, the browser says so and names the number instead
 * of sending a request that would 413.
 */
export const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

/** Agent profile photo — one file, its own form, its own action. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Headroom over MAX_UPLOAD_TOTAL_BYTES for everything else in the same
 * multipart body: the text fields, the multipart boundaries and part
 * headers, and the React Server Action envelope. Generous on purpose — the
 * client-side cap is the one an agent should ever meet.
 */
const BODY_OVERHEAD_BYTES = 1024 * 1024;

/**
 * What next.config.mjs feeds `experimental.serverActions.bodySizeLimit`.
 * Expressed in bytes rather than a `'21mb'` string so it is derived from
 * MAX_UPLOAD_TOTAL_BYTES arithmetically and cannot drift from it — the
 * whole failure above was two numbers that were supposed to agree and
 * didn't.
 */
export const SERVER_ACTION_BODY_SIZE_LIMIT_BYTES = MAX_UPLOAD_TOTAL_BYTES + BODY_OVERHEAD_BYTES;

/** Bytes → whole megabytes, for user-facing copy. */
export function megabytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** Sums `size` over a list of File-likes, ignoring anything without one. */
export function totalPhotoBytes(files) {
  return files.reduce((sum, file) => sum + (Number(file?.size) || 0), 0);
}

/**
 * The one validator both the browser and the Server Action run, so the
 * message an agent sees before sending is the same rule that would have
 * rejected the request after sending.
 *
 * Returns `null` when the selection is fine, otherwise `{ key, vars }` —
 * an i18n key plus its interpolation vars, never a finished string: this
 * module is imported by next.config.mjs and must not pull in a dictionary.
 *
 * @param {Array<{size?: number, type?: string}>} files photos being uploaded now
 * @param {{keptCount?: number, allowedTypes?: string[]}} [options]
 *   `keptCount` is the number of already-stored photos being kept (the edit
 *   form), which counts toward MAX_LISTING_PHOTOS but not toward the byte
 *   budget — those are URLs, not uploads.
 * @returns {{key: string, vars?: object}|null}
 */
export function validatePhotoSelection(files, { keptCount = 0, allowedTypes = null } = {}) {
  if (keptCount + files.length > MAX_LISTING_PHOTOS) {
    return { key: 'errors.tooManyPhotos', vars: { max: MAX_LISTING_PHOTOS } };
  }
  for (const file of files) {
    if (allowedTypes && !allowedTypes.includes(file?.type)) {
      return { key: 'errors.unsupportedPhotoFormat' };
    }
    if ((Number(file?.size) || 0) > MAX_LISTING_PHOTO_BYTES) {
      return { key: 'errors.photoTooLarge', vars: { max: megabytes(MAX_LISTING_PHOTO_BYTES) } };
    }
  }
  const total = totalPhotoBytes(files);
  if (total > MAX_UPLOAD_TOTAL_BYTES) {
    return {
      key: 'errors.uploadTooLarge',
      vars: { total: megabytes(total), max: megabytes(MAX_UPLOAD_TOTAL_BYTES) },
    };
  }
  return null;
}
