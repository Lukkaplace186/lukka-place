import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCES_DIFFER } from '../../lib/moderationQueue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', '..', 'lib', 'moderationQueue.js'), 'utf8');

// 2026-11-24 (owner): #1408 "mino congo" and #1376 "résidence d première
// ministre", same agent, same generated title and price, were shown as one
// property. On production 181 of 431 title+price pairs had clearly different
// references.

test('references clearly differ only when both are set and neither contains the other', () => {
  const sql = REFERENCES_DIFFER('o.reference', 'b.reference');
  assert.match(sql, /<> ''.*<> ''/s, 'an empty reference never separates two listings');
  assert.match(sql, /position\(.*\) = 0 AND position\(.*\) = 0/s, '"Saint-Luc" inside "derrière Saint-Luc" is still possibly the same');
  assert.match(sql, /\[\^\[:alnum:\]\]\+/, 'spaces and punctuation are ignored');
});

test('the title + price duplicate, its compare links and its same-agent mark all respect the reference', () => {
  assert.match(source, /o\.price = b\.price AND o\.approve_status <> 2\s+AND NOT \$\{REFERENCES_DIFFER\('o\.reference', 'b\.reference'\)\}/);
  assert.equal((source.match(/AND NOT \$\{REFERENCES_DIFFER\('o\.reference', 'f\.reference'\)\}/g) || []).length, 2);
});
