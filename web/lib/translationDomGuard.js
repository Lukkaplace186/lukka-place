/**
 * Stops browser page translation from crashing the app.
 *
 * WHAT BROKE. Edge's built-in translator (and Google Translate, and Chrome's
 * translate bar) does not change text in place: it REPLACES each text node
 * with `<font><font>translated</font></font>`. The text node React created is
 * detached. React does not know. On its next commit — switching the agent
 * dashboard's Demandes → Visites tab was the reported case — it calls
 * `parent.removeChild(thatTextNode)`, the browser throws
 * `NotFoundError: The node to be removed is not a child of this node`, and
 * the uncaught error takes down the whole route: Next's default global error,
 * "This page couldn't load — Reload to try again, or go back."
 *
 * Why it was invisible: it is purely client-side, so nothing reaches the
 * server log, and it only happens with translation switched on, so every
 * reproduction attempt without it (curl, a dev server, a clean browser)
 * worked. What gave it away was the screenshot itself — the wordmark read
 * "LukkaPlacer", and strings this app hardcodes in French ("avant-hier",
 * "reçues depuis votre page publique") appeared in inconsistent English.
 * Reproduced on a production build by rewriting text nodes exactly as the
 * translator does, then clicking the tab: identical screen, identical error.
 *
 * WHY THIS AND NOT `translate="no"`. Opting out would also prevent the crash,
 * but it removes a feature real agents use — the agent in the report was
 * translating the dashboard on purpose, because much of it is still French
 * under the EN toggle. That is a product decision, not a bug fix. This keeps
 * translation working and makes React's two affected DOM calls tolerate a
 * node that something else already moved. It is the mitigation React's own
 * maintainers pointed to (facebook/react#11538).
 *
 * THE TRADE, stated honestly: a genuine removeChild/insertBefore on the wrong
 * parent no longer throws either. In a React tree that only happens when
 * something outside React edited the DOM, so the masking cost is small; the
 * one-time console warning keeps it observable. A text node React fails to
 * remove may leave its translated copy on screen until the surrounding
 * element re-renders — a stale word is strictly better than a dead page.
 *
 * `insertBefore` falls back to APPENDING rather than skipping. Skipping is the
 * commonly-copied variant, and it silently drops the new node — on a tab
 * switch, that is the new tab's content.
 *
 * Shipped as a string, not a function, so the exact bytes the browser runs
 * are the bytes tests/unit/translation-dom-guard.test.js evaluates — a
 * function's `toString()` would be whatever the bundler's minifier made of
 * it. ASCII-only and ES5 because it runs inline while the HTML is parsed,
 * with no polyfills. Mounted in app/layout.js with
 * `strategy="beforeInteractive"`: it must patch `Node.prototype` before
 * React's first commit, and hydration is one.
 *
 * It does NOT have to run ahead of Next.js's chunk <script> tags, and in the
 * built HTML it doesn't. React DOM calls `parent.removeChild(node)` /
 * `parent.insertBefore(node, before)` as methods on the node, looked up at
 * call time — react-dom-client.production.js holds no cached
 * `Node.prototype` reference — so landing before hydration is enough.
 */
export const TRANSLATION_DOM_GUARD_SCRIPT = `(function () {
  if (typeof Node !== 'function' || !Node.prototype) return;
  var proto = Node.prototype;
  if (proto.removeChild && proto.removeChild.__lukkaTranslationGuard) return;
  var warned = false;
  function warn(what) {
    if (warned || typeof console === 'undefined') return;
    warned = true;
    console.warn('[translation-guard] ' + what + ': the DOM was changed outside React, most likely by browser page translation. Tolerated instead of crashing the page.');
  }
  var originalRemoveChild = proto.removeChild;
  var removeChild = function (child) {
    if (child && child.parentNode !== this) {
      warn('removeChild on a node that is no longer a child');
      return child;
    }
    return originalRemoveChild.apply(this, arguments);
  };
  removeChild.__lukkaTranslationGuard = true;
  proto.removeChild = removeChild;
  var originalInsertBefore = proto.insertBefore;
  var insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      warn('insertBefore with a reference node that is no longer a child');
      return originalInsertBefore.call(this, newNode, null);
    }
    return originalInsertBefore.apply(this, arguments);
  };
  insertBefore.__lukkaTranslationGuard = true;
  proto.insertBefore = insertBefore;
})();`;
