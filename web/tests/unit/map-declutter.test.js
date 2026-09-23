import test from 'node:test';
import assert from 'node:assert/strict';
import { declutterPins, orderForLabels } from '@/lib/mapDeclutter';

/**
 * The /listings map keeps every listing as its own pin (no clustering, an
 * explicit product direction). Where two price pills would overlap, one of
 * them shrinks to a dot at its real position. These pin the rules that decide
 * which one.
 */

const pill = (id, x, y, w = 50) => ({ id, x, y, w, h: 24 });

test('pills that do not touch all keep their price', () => {
  const shown = declutterPins([pill('a', 0, 0), pill('b', 200, 0), pill('c', 0, 200)]);
  assert.deepEqual([...shown].sort(), ['a', 'b', 'c']);
});

test('of two overlapping pills, the first in order keeps its price', () => {
  const shown = declutterPins([pill('first', 0, 0), pill('second', 20, 5)]);
  assert.ok(shown.has('first'));
  assert.ok(!shown.has('second'));
});

test('the gap counts: pills just touching are an overlap', () => {
  // 50px wide centres 52px apart leave 2px of air, under the 4px gap.
  assert.equal(declutterPins([pill('a', 0, 0), pill('b', 52, 0)]).size, 1);
  assert.equal(declutterPins([pill('a', 0, 0), pill('b', 60, 0)]).size, 2);
});

test('the pinned pin is labelled even on top of one already placed', () => {
  const shown = declutterPins([pill('placed', 0, 0), pill('pinned', 10, 0)], { always: 'pinned' });
  assert.ok(shown.has('pinned') && shown.has('placed'));
});

test('a pin with no screen position yet is left as a dot, never crashes', () => {
  const shown = declutterPins([{ id: 'x', x: NaN, y: 0, w: 40, h: 24 }, pill('y', 0, 0)]);
  assert.deepEqual([...shown], ['y']);
});

test('a dense city view keeps a readable subset, and every pill stays in the answer set or becomes a dot', () => {
  // 43 pills in a 300x200 box — the screenshot that prompted this.
  const pins = Array.from({ length: 43 }, (_, i) => pill(String(i), (i * 37) % 300, (i * 53) % 200));
  const shown = declutterPins(pins);
  assert.ok(shown.size > 5 && shown.size < 43, `labelled ${shown.size}`);
  // No two labelled pills overlap.
  const boxes = pins.filter((p) => shown.has(p.id));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < 24 + 4;
      assert.ok(!overlap, `${a.id} and ${b.id} both labelled but overlapping`);
    }
  }
});

test('label order: pinned, then the list page, then exact positions, then server order', () => {
  const pins = [
    { id: 'approx-new', approximate: true },
    { id: 'exact-old' },
    { id: 'on-page', approximate: true },
    { id: 'pinned', approximate: true },
    { id: 'exact-older' },
  ];
  const ordered = orderForLabels(pins, { pinnedId: 'pinned', pageIds: new Set(['on-page']) }).map((p) => p.id);
  assert.deepEqual(ordered, ['pinned', 'on-page', 'exact-old', 'exact-older', 'approx-new']);
});
