import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSLATION_DOM_GUARD_SCRIPT } from '@/lib/translationDomGuard';

/**
 * Runs the EXACT string app/layout.js ships against a minimal fake DOM — this
 * app has no jsdom, and a fake is enough: the guard only touches
 * `Node.prototype.removeChild` / `insertBefore`, and the fake's originals
 * throw NotFoundError on a foreign node exactly as a browser does, which is
 * the whole failure being guarded against.
 *
 * The crash, for the record: browser page translation replaces React's text
 * nodes with <font> wrappers; React's next commit removes a text node that is
 * no longer a child; the browser throws; the route dies with "This page
 * couldn't load". See lib/translationDomGuard.js.
 */

function notFound() {
  const err = new Error("Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.");
  err.name = 'NotFoundError';
  return err;
}

/** A fresh prototype per test — the guard mutates it. */
function makeDom() {
  class Node {
    constructor(label) { this.label = label; this.childNodes = []; this.parentNode = null; }
  }
  Node.prototype.removeChild = function removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i < 0) throw notFound();
    this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  };
  Node.prototype.insertBefore = function insertBefore(newNode, ref) {
    if (newNode.parentNode) newNode.parentNode.removeChild(newNode);
    if (ref == null) {
      this.childNodes.push(newNode);
    } else {
      const i = this.childNodes.indexOf(ref);
      if (i < 0) throw notFound();
      this.childNodes.splice(i, 0, newNode);
    }
    newNode.parentNode = this;
    return newNode;
  };
  const append = (parent, child) => parent.insertBefore(child, null);
  const warnings = [];
  const console = { warn: (...args) => warnings.push(args.join(' ')) };
  const install = () => new Function('Node', 'console', TRANSLATION_DOM_GUARD_SCRIPT)(Node, console);
  return { Node, append, warnings, install };
}

/** What the translator does to a text node React rendered. */
function translate(parent, textNode, { Node, append }) {
  const font = new Node('font');
  const i = parent.childNodes.indexOf(textNode);
  parent.childNodes.splice(i, 1, font);
  font.parentNode = parent;
  textNode.parentNode = null;
  append(font, new Node('translated text'));
  return font;
}

test('without the guard, the fake reproduces the production crash', () => {
  const dom = makeDom();
  const div = new dom.Node('div');
  const text = new dom.Node('#text');
  dom.append(div, text);
  translate(div, text, dom);
  assert.throws(() => div.removeChild(text), { name: 'NotFoundError' });
});

test('with the guard, removing a node the translator detached no longer throws', () => {
  const dom = makeDom();
  dom.install();
  const div = new dom.Node('div');
  const text = new dom.Node('#text');
  dom.append(div, text);
  const font = translate(div, text, dom);

  assert.equal(div.removeChild(text), text, 'returns the child, like the real method');
  assert.deepEqual(div.childNodes, [font], "the translator's node is left alone, not removed in its place");
});

test('with the guard, insertBefore against a detached reference appends instead of dropping the node', () => {
  const dom = makeDom();
  dom.install();
  const div = new dom.Node('div');
  const text = new dom.Node('#text');
  dom.append(div, text);
  translate(div, text, dom);

  const card = new dom.Node('new tab content');
  assert.equal(div.insertBefore(card, text), card);
  assert.ok(div.childNodes.includes(card), 'the new node is in the DOM — skipping it would blank the new tab');
  assert.equal(card.parentNode, div);
});

test('ordinary DOM operations are unchanged', () => {
  const dom = makeDom();
  dom.install();
  const ul = new dom.Node('ul');
  const a = new dom.Node('a');
  const b = new dom.Node('b');
  const c = new dom.Node('c');
  dom.append(ul, a);
  dom.append(ul, c);
  ul.insertBefore(b, c);
  assert.deepEqual(ul.childNodes.map((n) => n.label), ['a', 'b', 'c'], 'insertBefore still inserts at the reference');
  ul.removeChild(b);
  assert.deepEqual(ul.childNodes.map((n) => n.label), ['a', 'c'], 'removeChild still removes');
  assert.equal(b.parentNode, null);
});

test('a tolerated operation warns once per page, not once per node', () => {
  const dom = makeDom();
  dom.install();
  const div = new dom.Node('div');
  for (let i = 0; i < 5; i++) {
    const text = new dom.Node('#text');
    dom.append(div, text);
    translate(div, text, dom);
    div.removeChild(text);
  }
  assert.equal(dom.warnings.length, 1);
  assert.match(dom.warnings[0], /translation/);
});

test('installing twice does not wrap twice', () => {
  const dom = makeDom();
  dom.install();
  const remove = dom.Node.prototype.removeChild;
  const insert = dom.Node.prototype.insertBefore;
  dom.install();
  assert.equal(dom.Node.prototype.removeChild, remove);
  assert.equal(dom.Node.prototype.insertBefore, insert);
});

test('the script is inert where there is no DOM', () => {
  assert.doesNotThrow(() => new Function('Node', 'console', TRANSLATION_DOM_GUARD_SCRIPT)(undefined, { warn() {} }));
});

test('it is ASCII-only, so no encoding step can corrupt the inline script', () => {
  assert.equal([...TRANSLATION_DOM_GUARD_SCRIPT].filter((ch) => ch.charCodeAt(0) > 127).length, 0);
});

test('the root layout mounts it before hydration', () => {
  const layout = readFileSync(new URL('../../app/layout.js', import.meta.url), 'utf8');
  assert.match(layout, /import\s*\{\s*TRANSLATION_DOM_GUARD_SCRIPT\s*\}\s*from\s*'@\/lib\/translationDomGuard'/);
  const tag = layout.match(/<Script[^>]*id="translation-dom-guard"[^>]*>/s)?.[0];
  assert.ok(tag, 'a <Script id="translation-dom-guard"> in app/layout.js');
  assert.match(tag, /strategy="beforeInteractive"/, 'afterInteractive would patch after hydration — too late for the first commit');
  assert.match(tag, /TRANSLATION_DOM_GUARD_SCRIPT/);
});

test('the Demandes/Visites tab bodies are keyed, so a tab switch remounts instead of patching text', () => {
  // The reported crash site. Without distinct keys both bodies reconcile
  // element-for-element (same header-row shape), so React rewrites text nodes
  // that translation has already replaced — the crash, and with the guard in
  // place, a stale translated subtitle left beside the new one.
  const page = readFileSync(new URL('../../app/compte/agent/demandes/page.js', import.meta.url), 'utf8');
  assert.match(page, /<Fragment key="visites">\s*<VisitsTab/);
  assert.match(page, /<Fragment key="mes-demandes">/);
});
