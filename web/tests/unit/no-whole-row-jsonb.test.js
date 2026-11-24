/**
 * Listing queries read columns, not to_jsonb(p) (web/CLAUDE.md, 2026-11-24).
 *
 * `properties` carries `embedding vector(1536)`, 90% of each row's bytes.
 * `to_jsonb(p) ->> 'x'` serialises the WHOLE row, vector included, once per
 * call per row: measured on production, one such read over every listing took
 * 97 ms against 0.7 ms for the plain column, and the card query (about 15 of
 * them) took 614 ms against 49 ms once rewritten. It was the database's
 * biggest consumer the day Supabase warned the Disk IO budget was running out.
 *
 * The pattern began as "survive running before the migration"; every column
 * now exists everywhere. Read the column (`p.x`), or `to_jsonb(p.x) #>> '{}'`
 * where a caller relies on the old text form. This scans every lib module
 * where `p` is `properties`. `move_projects` / `partners` aliased `p` are
 * small tables without a vector and are left alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(WEB, 'lib');

/** Code only: comments may still explain why the pattern is gone. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/^\s*--.*$/gm, '');
}

const usesPropertiesAsP = (source) => /\bproperties\s+p\b/.test(source);

test('no lib module that queries properties as p serialises the whole row', () => {
  const offenders = [];
  for (const name of fs.readdirSync(LIB)) {
    if (!name.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(LIB, name), 'utf8');
    if (!usesPropertiesAsP(source)) continue;
    if (/to_jsonb\(\s*p\s*\)/.test(stripComments(source))) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `whole-row to_jsonb(p) in: ${offenders.join(', ')}`);
});

test('the scan would catch it (the check is not vacuous)', () => {
  const sample = "SELECT to_jsonb(p) ->> 'moderated_at' FROM properties p";
  assert.ok(usesPropertiesAsP(sample));
  assert.match(stripComments(sample), /to_jsonb\(\s*p\s*\)/);
  // and a comment mentioning it is not code
  assert.doesNotMatch(stripComments('// never to_jsonb(p) here\n'), /to_jsonb\(\s*p\s*\)/);
});
