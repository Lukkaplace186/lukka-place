import test from 'node:test';
import assert from 'node:assert/strict';
import nextConfig from '@/next.config.mjs';
import {
  MAX_AVATAR_BYTES,
  MAX_LISTING_PHOTOS,
  MAX_LISTING_PHOTO_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
  SERVER_ACTION_BODY_SIZE_LIMIT_BYTES,
  megabytes,
  totalPhotoBytes,
  validatePhotoSelection,
} from '@/lib/uploadLimits.mjs';

/**
 * The bug this pins: Next.js caps a Server Action request body at 1 MB when
 * `experimental.serverActions.bodySizeLimit` is unset, and it was unset,
 * while the agent form advertised 5 MB per photo and ten photos. Every real
 * submission was aborted with a 413 *before the action ran* — no validation,
 * no session check, no `{ok:false}` for the UI to show. WhatsApp intake was
 * unaffected because it reaches the engine over plain Express.
 *
 * So the assertion that matters is a relationship, not a number: whatever
 * the app tells an agent it will accept must fit inside what the transport
 * will carry. A future edit that raises the photo budget without raising the
 * transport ceiling fails here rather than in production.
 */

const configuredLimit = nextConfig.experimental?.serverActions?.bodySizeLimit;

test('next.config.mjs configures a Server Action body limit at all', () => {
  assert.notEqual(
    configuredLimit,
    undefined,
    'unset means Next.js applies its 1 MB default, which no photo upload survives',
  );
});

test('the transport ceiling carries the whole advertised photo budget', () => {
  assert.equal(typeof configuredLimit, 'number', 'bytes, so it cannot drift from the constant it derives from');
  assert.equal(configuredLimit, SERVER_ACTION_BODY_SIZE_LIMIT_BYTES);
  assert.ok(
    configuredLimit > MAX_UPLOAD_TOTAL_BYTES,
    `body limit ${configuredLimit} must exceed the ${MAX_UPLOAD_TOTAL_BYTES}-byte photo budget, with room for the form fields and multipart overhead`,
  );
  assert.ok(
    configuredLimit > MAX_AVATAR_BYTES,
    'the avatar action posts through the same transport',
  );
});

test('a single photo can never on its own exceed the total budget', () => {
  assert.ok(MAX_LISTING_PHOTO_BYTES <= MAX_UPLOAD_TOTAL_BYTES,
    'otherwise one accepted photo would be refused by the total, which is unexplainable to an agent');
});

test('validatePhotoSelection accepts a realistic listing', () => {
  const photos = Array.from({ length: 6 }, () => ({ size: 2 * 1024 * 1024, type: 'image/jpeg' }));
  assert.equal(validatePhotoSelection(photos), null);
});

test('too many photos is reported as a count problem, before any byte total', () => {
  const photos = Array.from({ length: MAX_LISTING_PHOTOS + 1 }, () => ({ size: 1024, type: 'image/jpeg' }));
  assert.deepEqual(validatePhotoSelection(photos), {
    key: 'errors.tooManyPhotos',
    vars: { max: MAX_LISTING_PHOTOS },
  });
});

test('already-stored photos count toward the maximum but not toward the bytes', () => {
  const one = [{ size: 1024, type: 'image/jpeg' }];
  assert.equal(validatePhotoSelection(one, { keptCount: MAX_LISTING_PHOTOS - 1 }), null);
  assert.equal(validatePhotoSelection(one, { keptCount: MAX_LISTING_PHOTOS })?.key, 'errors.tooManyPhotos');
});

test('one oversized photo is named as such', () => {
  const photos = [{ size: MAX_LISTING_PHOTO_BYTES + 1, type: 'image/jpeg' }];
  assert.deepEqual(validatePhotoSelection(photos), {
    key: 'errors.photoTooLarge',
    vars: { max: megabytes(MAX_LISTING_PHOTO_BYTES) },
  });
});

test('individually-legal photos that overflow the request are caught by the total', () => {
  // Eight 4 MB photos: every one inside the 5 MB per-file cap, 32 MB together.
  const photos = Array.from({ length: 8 }, () => ({ size: 4 * 1024 * 1024, type: 'image/jpeg' }));
  assert.ok(photos.every((p) => p.size <= MAX_LISTING_PHOTO_BYTES));
  const problem = validatePhotoSelection(photos);
  assert.equal(problem.key, 'errors.uploadTooLarge');
  assert.equal(problem.vars.total, megabytes(totalPhotoBytes(photos)));
  assert.equal(problem.vars.max, megabytes(MAX_UPLOAD_TOTAL_BYTES));
});

test('the format allow-list is only applied when one is supplied', () => {
  const gif = [{ size: 1024, type: 'image/gif' }];
  assert.equal(validatePhotoSelection(gif), null, 'the browser copy leaves MIME to the file input');
  assert.equal(
    validatePhotoSelection(gif, { allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] })?.key,
    'errors.unsupportedPhotoFormat',
  );
});

test('every error key the validator can return exists in both dictionaries', async () => {
  const fr = (await import('@/lib/i18n/fr.json', { with: { type: 'json' } })).default;
  const en = (await import('@/lib/i18n/en.json', { with: { type: 'json' } })).default;
  for (const key of ['tooManyPhotos', 'photoTooLarge', 'uploadTooLarge', 'unsupportedPhotoFormat', 'submissionFailed', 'fileTooLarge']) {
    assert.equal(typeof fr.errors[key], 'string', `fr.errors.${key}`);
    assert.equal(typeof en.errors[key], 'string', `en.errors.${key}`);
  }
});
