import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listingVideos, isVideoPoster, VIDEOS_SQL, VIDEO_COUNT_SQL } from '@/lib/listingVideos';
import { MAX_LISTING_PHOTOS } from '@/lib/uploadLimits.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('listingVideos keeps https videos in order, with their cover frame', () => {
  const videos = listingVideos({
    videos: [
      { url: 'https://x.supabase.co/a.mp4', poster: 'https://x.supabase.co/a_poster.jpg' },
      { url: 'https://x.supabase.co/b.mp4', poster: null },
    ],
  });
  assert.deepEqual(videos, [
    { url: 'https://x.supabase.co/a.mp4', poster: 'https://x.supabase.co/a_poster.jpg' },
    { url: 'https://x.supabase.co/b.mp4', poster: null },
  ]);
});

test('listingVideos drops what is not a playable https URL, and duplicates', () => {
  assert.deepEqual(listingVideos({ videos: null }), []);
  assert.deepEqual(listingVideos({}), []);
  assert.deepEqual(listingVideos({ videos: 'not json' }), []);
  assert.deepEqual(
    listingVideos({
      videos: [
        { url: 'javascript:alert(1)' },
        { url: 'http://insecure.example/a.mp4' },
        { url: 'https://x.supabase.co/a.mp4', poster: 'javascript:x' },
        { url: 'https://x.supabase.co/a.mp4' },
      ],
    }),
    [{ url: 'https://x.supabase.co/a.mp4', poster: null }],
  );
  assert.deepEqual(listingVideos({ videos: '[{"url":"https://x.supabase.co/c.mp4"}]' }), [
    { url: 'https://x.supabase.co/c.mp4', poster: null },
  ]);
});

test('a cover frame is told from a photo by its name', () => {
  assert.ok(isVideoPoster('https://x.supabase.co/properties/9/whatsapp_abc_poster.jpg'));
  assert.ok(!isVideoPoster('https://x.supabase.co/properties/9/whatsapp_abc_e5.jpg'));
});

test('videos are read through to_jsonb, so nothing 42703s before the migration', () => {
  assert.match(VIDEOS_SQL, /to_jsonb\(p\) -> 'videos'/);
  assert.match(VIDEO_COUNT_SQL, /jsonb_typeof/);
  assert.match(read('lib/listings.js'), /\$\{VIDEOS_SQL\} AS videos/);
});

test('a video-only listing is not flagged "no photos" in the moderation queue', () => {
  const source = read('lib/moderationQueue.js');
  assert.match(source, /b\.photo_count = 0 AND b\.video_count = 0 AND/);
  assert.match(source, /videos: listingVideos\(row\)/);
  assert.match(source, /!isVideoPoster\(src\)/, 'a cover frame is never offered as a gallery photo');
});

test('the listing page and the moderation panel show the videos', () => {
  assert.match(read('app/(site)/listings/[id]/page.js'), /<ListingVideos/);
  assert.match(read('app/admin/listings/[id]/ListingModerationPanel.js'), /info\.videos/);
});

test('removing every photo keeps the video cover as the card image', () => {
  assert.match(read('lib/agentListings.js'), /COALESCE\(\$1, NULLIF\(to_jsonb\(properties\) -> 'videos' -> 0 ->> 'poster', ''\), \$3\)/);
});

test('20 photos per listing, the same figure as the engine', () => {
  assert.equal(MAX_LISTING_PHOTOS, 20);
  const engine = path.join(root, '..', 'services', 'listingMedia.js');
  if (fs.existsSync(engine)) {
    assert.match(fs.readFileSync(engine, 'utf8'), new RegExp(`const MAX_LISTING_PHOTOS = ${MAX_LISTING_PHOTOS};`));
  }
});
