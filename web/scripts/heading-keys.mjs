import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * "Which dictionary strings are headings?" — one answer, imported by both
 * scripts/apply-title-case.mjs (which rewrites them) and
 * tests/unit/heading-capitalization.test.js (which asserts they stayed
 * rewritten). Two copies of this would drift the first time a heading key
 * was named something the transform recognised and the test did not, and the
 * failure would be silent: a heading quietly not in Title Case.
 *
 * Three sources, unioned:
 *   - naming convention (`…title`, `…heading`, `…eyebrow`)
 *   - keys the app actually renders inside an <h1>–<h6>, read out of the JSX
 *     rather than listed by hand — a hardcoded list would need updating by
 *     the same person who forgot to update it.
 *   - keys handed to a component *prop* that the component then renders
 *     inside a heading (`<Panel title={t('…')}>` -> `<h2>{title}</h2>`).
 *     Which props those are is derived from the JSX too, never listed.
 */

function isHeadingKey(key) {
  return /(title|heading|eyebrow)$/i.test(key) && !/subtitle$/i.test(key);
}

export function conventionKeys(dict) {
  const out = [];
  (function walk(node, prefix) {
    for (const [key, value] of Object.entries(node)) {
      const keyPath = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') walk(value, keyPath);
      // `subtitle` ENDS IN `title` and would be swept in by the suffix match,
      // but a subtitle is body copy, not a heading — "List Your Properties and
      // Receive Customer Enquiries on WhatsApp." is not a sentence anyone
      // wants under a banner. Excluded explicitly.
      else if (typeof value === 'string' && isHeadingKey(key)) out.push(keyPath);
    }
  })(dict, '');
  return out;
}

export function sourceFiles(root) {
  return execSync('find app components -name "*.js" -o -name "*.jsx"', { encoding: 'utf8', cwd: root })
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((f) => f.split(path.sep).join('/'));
}

/**
 * Radix's dialog/sheet titles. They ARE headings — Radix renders one as an
 * <h2> and points `aria-labelledby` at it — but they never appear as `<hN>`
 * in our source, so the element scan below cannot see them.
 */
const ARIA_TITLE_ELEMENTS = ['DialogTitle', 'SheetTitle', 'AlertDialogTitle', 'DrawerTitle'];

const HEADING_REGION = new RegExp(
  '<(h[1-6]|' + ARIA_TITLE_ELEMENTS.join('|') + ')\\b[^>]*>([\\s\\S]*?)</\\1>',
  'g',
);

/**
 * `t('a.b')` calls that are TEXT inside a region, not attribute values — an
 * `aria-label={t('…')}` on a link inside an <h2> is not that heading.
 */
function textKeysIn(region) {
  const keys = [];
  for (const m of region.matchAll(/t\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    const before = region.slice(Math.max(0, m.index - 40), m.index);
    if (/[\w-]+\s*=\s*\{\s*$/.test(before)) continue; // attribute value, not the heading
    keys.push(m[1]);
  }
  return keys;
}

/** `<h2 ...>{t('a.b.c')}</h2>` — the key, wherever a heading element renders one. */
export function headingKeysInSource(root) {
  const keys = new Set();
  for (const file of sourceFiles(root)) {
    const src = readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(HEADING_REGION)) for (const key of textKeysIn(m[2])) keys.add(key);
  }
  return [...keys];
}

/** `function Name({ a, b: C })` / `const Name = ({ a }) =>` */
const COMPONENT_DEF =
  /(?:function\s+([A-Z]\w*)\s*\(\s*\{([\s\S]*?)\}|const\s+([A-Z]\w*)\s*=\s*(?:async\s*)?\(\s*\{([\s\S]*?)\}\s*\)\s*=>)/g;

/** local identifier used in the body -> the prop name it arrived as. */
function destructuredProps(params) {
  const map = new Map();
  for (const part of params.split(',')) {
    const bare = part.split('=')[0].trim();
    if (!bare || bare.startsWith('...')) continue;
    const [name, alias] = bare.split(':').map((s) => s.trim());
    if (!/^[\w$]+$/.test(name)) continue;
    map.set(alias && /^[\w$]+$/.test(alias) ? alias : name, name);
  }
  return map;
}

/**
 * Components that render one of their props inside a heading:
 * `<h2>{title}</h2>` -> `{ Panel: Set{'title'} }`. Derived, not listed — a
 * hand-kept list is exactly what goes stale when someone adds a dashboard
 * panel.
 */
export function headingPropComponents(root) {
  const byComponent = new Map();
  for (const file of sourceFiles(root)) {
    const src = readFileSync(path.join(root, file), 'utf8');
    const defs = [...src.matchAll(COMPONENT_DEF)].map((m) => ({
      index: m.index,
      name: m[1] || m[3],
      props: destructuredProps(m[2] ?? m[4] ?? ''),
    }));

    for (const region of src.matchAll(HEADING_REGION)) {
      // The component this heading belongs to: the last definition that opens
      // before it. Nearest-preceding is right for this codebase, where helper
      // components are declared one after another at file scope.
      const owner = defs.filter((d) => d.index < region.index).pop();
      if (!owner) continue;
      for (const m of region[2].matchAll(/\{\s*([\w$]+)\s*\}/g)) {
        const prop = owner.props.get(m[1]);
        if (!prop) continue;
        if (!byComponent.has(owner.name)) byComponent.set(owner.name, new Set());
        byComponent.get(owner.name).add(prop);
      }
    }
  }
  return byComponent;
}

/**
 * The JSX opening tag starting at `from`: its attribute text, and where it
 * ends. Brace-aware, so neither an arrow function in a handler
 * (`onClick={() => …}`) nor a whole element passed as a prop
 * (`action={<button>…</button>}`) ends the tag early.
 */
function openingTag(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return { attrs: src.slice(from, i), end: i + 1 };
  }
  return { attrs: src.slice(from), end: src.length };
}

/**
 * `<Panel title={t('admin.dashboard.devices')}>` — a heading key that never
 * appears next to an `<h2>`, because the `<h2>` is inside the component.
 * Scoped to the opening tag, so a tooltip `title={t('…')}` on a <button> is
 * not mistaken for a heading.
 */
export function propFedHeadingKeys(root, components = headingPropComponents(root)) {
  const keys = new Set();
  if (components.size === 0) return [];
  const usage = new RegExp('<(' + [...components.keys()].join('|') + ')(?=[\\s/>])', 'g');

  for (const file of sourceFiles(root)) {
    const src = readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(usage)) {
      const props = components.get(m[1]);
      const { attrs, end } = openingTag(src, m.index + m[0].length);
      for (const a of attrs.matchAll(/([\w-]+)\s*=\s*\{\s*t\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (props.has(a[1])) keys.add(a[2]);
      }
      // `<SectionTitle>{t('…')}</SectionTitle>` — the heading arrives as
      // children rather than as a named prop. Scanned from AFTER the opening
      // tag: `<SectionTitle action={<button>{t('…copied')}</button>}>` puts a
      // button label inside the tag, and that label is not the heading.
      if (props.has('children')) {
        const close = src.indexOf('</' + m[1] + '>', end);
        if (close > -1) for (const key of textKeysIn(src.slice(end, close))) keys.add(key);
      }
    }
  }
  return [...keys];
}

/** Every heading key in `dict`, from all three sources, sorted and de-duplicated. */
export function allHeadingKeys(dict, root) {
  return [...new Set([...conventionKeys(dict), ...headingKeysInSource(root), ...propFedHeadingKeys(root)])]
    .filter((key) => headingStrings(dict, key).length > 0)
    .sort();
}

const PLURAL_FORMS = ['zero', 'one', 'other'];

/**
 * The strings a heading key can render, each with the path that holds it.
 *
 * A heading entry is not always a string: `agent.listings.deleteBulkTitle` is
 * `{ one: "Delete {count} listing?", other: "Delete {count} listings?" }`,
 * and both forms land in the same `<h2>`. Treating the entry as a string
 * skipped every plural heading silently — they were the last two English
 * headings still in sentence case.
 */
export function headingStrings(dict, keyPath) {
  const node = lookup(dict, keyPath);
  if (typeof node === 'string') return [{ path: keyPath, value: node }];
  if (node && typeof node === 'object') {
    return PLURAL_FORMS.filter((form) => typeof node[form] === 'string').map((form) => ({
      path: `${keyPath}.${form}`,
      value: node[form],
    }));
  }
  return [];
}

export function lookup(dict, keyPath) {
  return keyPath.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dict);
}

export function setIn(dict, keyPath, value) {
  const parts = keyPath.split('.');
  const last = parts.pop();
  const parent = parts.reduce((node, part) => node[part], dict);
  parent[last] = value;
}
