import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { sourceFiles } from '../../scripts/heading-keys.mjs';

/**
 * **A file that defines `labelKey:` must never read `.label`.**
 *
 * This exists because of a real outage, not a hypothetical one. The FR/EN
 * i18n migration (059725a) renamed the field on `LISTING_STATUS_OPTIONS` in
 * app/compte/agent/biens/page.js from `label` to `labelKey` and rewrote the
 * two JSX sites that rendered it as `{t(o.labelKey)}` — but missed a third
 * read, `o.label.toLowerCase()`, buried in the counts string above the table.
 * `undefined.toLowerCase()` throws, so Mes biens threw on EVERY render for
 * every agent, with no data-dependent path to it: the whole page was a 500
 * and the agent saw "This page couldn't load".
 *
 * Nothing caught it. It is not a type error JS reports at build time, the
 * page has no render test, and `next build` compiles a Server Component that
 * throws at request time perfectly happily — the same blind spot
 * i18n-translator-binding.test.js was written for.
 *
 * The scan found two more instances of the same drift, both shipped by the
 * same migration and both silent rather than fatal: the Demandes page's tabs
 * (`{t.label}` on a `labelKey` constant — and the iteration variable shadowed
 * the translator, which is why that one could not be rewritten mechanically)
 * and every option in AgentLeadCard's per-lead status select. Blank tabs and a
 * dropdown of empty options, with no error anywhere.
 *
 * The rule is deliberately narrow so it stays true rather than accumulating
 * exceptions: only files that define `labelKey:` and never define a plain
 * `label:` are checked. In such a file no object carries a `label` property at
 * all, so any `.label` read is dead by construction.
 */

const ROOT = process.cwd();

/**
 * Comments and string literals are stripped before scanning. Both produce real
 * false positives: `t('common.language.label')` is a dictionary dot-path, not
 * a property read, and a comment discussing this bug would otherwise flag the
 * very file that documents its own fix.
 *
 * A regex strip is enough — this looks for one token, it does not parse JS.
 * Offenders are reported by content rather than line number, since the line
 * numbers here are the stripped file's.
 *
 * Template literals are deliberately NOT stripped. `${…}` interpolations are
 * live code, and the original crash lived inside one — a rule that blanked
 * whole backtick literals passed happily on the unfixed page, which is how
 * this function was caught being wrong.
 */
function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/**
 * `foo.label` — a property READ. `aria-label` and a `label={…}` JSX prop need
 * no exclusion: neither carries a leading dot.
 */
const LABEL_READ = /\.label\b(?!Key)/g;

/** `label:` as an object-literal key. Excludes `labelKey:`. */
const DEFINES_LABEL = /(?<![\w.])label\s*:/;
const DEFINES_LABEL_KEY = /(?<![\w.])labelKey\s*:/;

test('no file that defines only `labelKey:` reads `.label`', () => {
  const offenders = [];

  for (const file of sourceFiles(ROOT)) {
    const source = stripCommentsAndStrings(readFileSync(path.join(ROOT, file), 'utf8'));
    if (!DEFINES_LABEL_KEY.test(source)) continue;
    if (DEFINES_LABEL.test(source)) continue;

    for (const line of source.split('\n')) {
      LABEL_READ.lastIndex = 0;
      if (LABEL_READ.test(line)) offenders.push(`${file}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These files build their options with `labelKey` but read `.label`, which is always ' +
      'undefined — the exact drift that took the Mes biens page down:\n  ' +
      offenders.join('\n  '),
  );
});

/**
 * The constant behind the outage, pinned directly: every LISTING_STATUS_OPTIONS
 * entry must expose a key the dictionary actually resolves. The scan above
 * proves the page does not read a field that does not exist; this proves the
 * field it does read points at real copy, and that the value is a string the
 * counts line can call `.toLowerCase()` on.
 */
test('every LISTING_STATUS_OPTIONS entry on Mes biens resolves to real French copy', async () => {
  const source = readFileSync(path.join(ROOT, 'app/compte/agent/biens/page.js'), 'utf8');
  const block = source.match(/const LISTING_STATUS_OPTIONS = \[([\s\S]*?)\];/);
  assert.ok(block, 'LISTING_STATUS_OPTIONS not found — did the constant move?');

  const keys = [...block[1].matchAll(/labelKey:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(keys.length, 3, 'expected three listing statuses');

  const { default: fr } = await import('@/lib/i18n/fr.json', { with: { type: 'json' } });
  for (const key of keys) {
    const value = key.split('.').reduce((node, segment) => (node == null ? node : node[segment]), fr);
    assert.equal(typeof value, 'string', `${key} has no French string — the counts line would render the raw key`);
    assert.doesNotThrow(() => value.toLowerCase());
  }
});
