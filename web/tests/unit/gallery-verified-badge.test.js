import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// "Annonce vérifiée" on the photo is a claim about the PROPERTY
// (properties.verified_at, set by a human from /admin/listings/[id]) — never
// moderation. It rendered unconditionally, so every live listing wore it.
test('the gallery\'s verified badge renders only on a real verified_at', () => {
  const gallery = readFileSync(new URL('../../components/PhotoGallery.js', import.meta.url), 'utf8');
  const badges = gallery.match(/<Badge tone="white">\{t\('listings\.gallery\.verified'\)\}<\/Badge>/g) || [];
  assert.equal(badges.length, 2, 'phone and desktop layouts each carry one');
  const gated = gallery.match(/\{verifiedAt \? \(\s*<span[^>]*>\s*<Badge tone="white">\{t\('listings\.gallery\.verified'\)\}/g) || [];
  assert.equal(gated.length, 2, 'both are behind verifiedAt');
  const page = readFileSync(new URL('../../app/(site)/listings/[id]/page.js', import.meta.url), 'utf8');
  assert.match(page, /verifiedAt=\{listing\.verified_at\}/);
});
