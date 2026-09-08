import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Every function that calls `t(...)` must have a translator in scope.
 *
 * `t` is not a module-level binding anywhere in this app — it comes from
 * `useT()` in a client component, `await getT()` on the server, or a
 * parameter. A function that calls it without one is a ReferenceError at
 * RENDER time, so the build passes and the page 500s instead.
 *
 * That is not hypothetical: it shipped repeatedly during the i18n migration
 * and was caught in a browser, not by the build. Two cases are worth
 * remembering — `Wordmark` in components/Brand.js is a NAMED export, so a
 * check that only inspected each file's default export saw nothing wrong
 * while every page rendering the header crashed; and `FavoritesSection` in
 * /favoris was missed by an earlier version of THIS test, whose brace-depth
 * walk was thrown off by an apostrophe in French JSX text being mistaken for
 * the start of a string literal.
 *
 * Hence the regioning below: functions are delimited by the NEXT top-level
 * declaration rather than by counting braces, which needs no lexing of the
 * body and so cannot be confused by apostrophes, template literals or JSX.
 */

const ROOT = process.cwd();

/** A top-level declaration: `function x`, `const x =`, `class x`, `export …`. */
const TOP_LEVEL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=|class\s+(\w+))/;

function regions(src) {
  const lines = src.split('\n');
  const starts = [];
  lines.forEach((line, i) => {
    // Column 0 only — a nested declaration is part of its parent's region.
    if (/^\S/.test(line) && TOP_LEVEL.test(line)) {
      const m = TOP_LEVEL.exec(line);
      starts.push({ name: m[1] || m[2] || m[3], line: i, signature: line });
    }
  });

  return starts.map((s, i) => ({
    ...s,
    body: lines.slice(s.line, i + 1 < starts.length ? starts[i + 1].line : lines.length).join('\n'),
  }));
}

/** Blank comments IN PLACE so the reported line numbers match the real file. */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

test('every function calling t() has a translator in scope', () => {
  const files = execSync('find app components lib -name "*.js" -o -name "*.jsx"', { encoding: 'utf8', cwd: ROOT })
    .trim().split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));

  const offenders = [];

  for (const file of files) {
    const src = stripComments(readFileSync(`${ROOT}/${file}`, 'utf8'));
    if (!/[^\w.$]t\(/.test(src)) continue;

    for (const region of regions(src)) {
      if (!/[^\w.$]t\(/.test(region.body)) continue;

      const binds =
        /const\s+t\s*=\s*useT\(\)/.test(region.body) ||
        /const\s+t\s*=\s*await\s+getT\(\)/.test(region.body) ||
        // `const { locale, messages, t } = await getI18n(NS)` — the third real
        // way to obtain a translator, and the one a layout that ALSO seeds the
        // client provider uses. It is documented in lib/i18n/server.js but no
        // layout destructured its `t` until (portfolio) mounted a provider, so
        // this check flagged a correctly-bound function as an offender.
        /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*await\s+getI18n\(/.test(region.body) ||
        // `t` arrives as a parameter: fn(x, t), fn({ t, … }), (x, t) => …
        /\(\s*[^)]*\bt\b\s*[,)]/.test(region.signature) ||
        /\{[^}]*\bt\b[^}]*\}\s*\)/.test(region.signature) ||
        // a map of functions that each take `t`, e.g. RELAXABLE_LABEL
        /\(\s*t\s*,/.test(region.body);

      if (!binds) offenders.push(`${file}:${region.line + 1} ${region.name}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these top-level declarations call t() with no translator in scope —\n' +
      'a render-time ReferenceError the build cannot catch:\n  ' + offenders.join('\n  '),
  );
});

/**
 * The two classes above are about `t`. These next two are about how the
 * translator is OBTAINED, and each one took lukkaplace.com down with a 500
 * on every route after a build that reported success.
 *
 * Both are invisible to `next build` for the same reason: the routes that
 * render them are dynamic (`ƒ`), so the build compiles them but never
 * executes them. Only a request does — which is why these are tests and not
 * a note in a doc.
 */

/** Files that legitimately DEFINE the helpers rather than consume them. */
const I18N_MODULES = ['lib/i18n/server.js', 'lib/i18n/client.js'];

function sourceFiles() {
  return execSync('find app components lib -name "*.js" -o -name "*.jsx"', { encoding: 'utf8', cwd: ROOT })
    .trim().split('\n').filter(Boolean).map((f) => f.replace(/\\/g, '/'));
}

test('getT() is only called where getT is actually imported', () => {
  const offenders = [];

  for (const file of sourceFiles()) {
    if (I18N_MODULES.includes(file)) continue;
    const src = stripComments(readFileSync(`${ROOT}/${file}`, 'utf8'));
    if (!/[^\w.$]getT\s*\(/.test(src)) continue;

    if (!/import\s*\{[^}]*\bgetT\b[^}]*\}\s*from/.test(src)) {
      const line = src.split('\n').findIndex((l) => /[^\w.$]getT\s*\(/.test(l)) + 1;
      offenders.push(`${file}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'these files call getT() without importing it — a render-time\n' +
      '"getT is not defined". This is exactly how app/layout.js\'s\n' +
      'generateMetadata 500\'d every page in production:\n  ' + offenders.join('\n  '),
  );
});

test("client i18n hooks are only called from 'use client' modules", () => {
  const offenders = [];

  for (const file of sourceFiles()) {
    if (I18N_MODULES.includes(file)) continue;
    const raw = readFileSync(`${ROOT}/${file}`, 'utf8');
    const src = stripComments(raw);
    if (!/[^\w.$](useT|useLocale)\s*\(/.test(src)) continue;

    // The directive must be the first real statement in the file.
    if (!/^\s*(?:['"]use client['"])/.test(raw)) {
      const line = src.split('\n').findIndex((l) => /[^\w.$](useT|useLocale)\s*\(/.test(l)) + 1;
      offenders.push(`${file}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these modules call a client i18n hook but carry no 'use client'\n" +
      'directive, so they render on the server and throw at request time.\n' +
      'Importing I18nProvider (a component) is fine; calling useT/useLocale\n' +
      'is not. Both RelatedListings.js and AgentStatGrid.js shipped this:\n  ' + offenders.join('\n  '),
  );
});
