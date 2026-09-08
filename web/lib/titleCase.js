/**
 * English Title Case for headings — one definition, used by the script that
 * transformed lib/i18n/en.json and by the test that keeps it that way
 * (tests/unit/heading-capitalization.test.js). Two copies of these word
 * lists would drift the first time somebody added a heading.
 *
 * **English only.** French headings take sentence case ("Créer un compte
 * agent"), which is the correct convention there — running this over fr.json
 * would produce "Créer Un Compte Agent", which reads to a French speaker the
 * way "create an agent account" reads to an English one. That is why nothing
 * imports this for the French dictionary.
 *
 * **Not `text-transform: capitalize`.** That CSS utility uppercases every
 * word, giving "Are You An Estate Agent Or Agency?" — articles, conjunctions
 * and prepositions included — which is not title case. It also cannot leave
 * an acronym alone or skip an interpolation. The strings are transformed at
 * source instead, so the diff is reviewable and the rendered text is the
 * text in the dictionary.
 */

/**
 * Lowercased mid-title: articles, coordinating conjunctions, and prepositions
 * of four letters or fewer. First and last word always win over this list.
 */
const MINOR_WORDS = new Set([
  // articles
  'a', 'an', 'the',
  // coordinating conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
  // short prepositions
  'as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via',
  'from', 'into', 'like', 'near', 'onto', 'over', 'past', 'than', 'with',
]);

/**
 * A word that already carries a capital somewhere other than the first
 * character is a deliberate spelling — an acronym ("OTP", "CDF") or a
 * camel-cased brand ("WhatsApp", "PayPal"). Title case must not touch it;
 * naive capitalization turns "WhatsApp" into "Whatsapp".
 */
function hasDeliberateCasing(word) {
  return /[A-Z]/.test(word.slice(1));
}

/** `{count}`, `{place}` — a value substituted at render, never re-cased. */
function isInterpolation(token) {
  return token.startsWith('{') && token.endsWith('}');
}

function capitalizeFirstLetter(word) {
  // Skip leading punctuation ("(hello" -> "(Hello") to find the real letter.
  return word.replace(/^([^\p{L}]*)(\p{L})/u, (_, lead, letter) => lead + letter.toLocaleUpperCase('en'));
}

function lowercaseWord(word) {
  return word.toLocaleLowerCase('en');
}

/**
 * A hyphenated compound is title-cased on both sides ("Well-Known"), which is
 * what every style guide this app would be measured against does.
 */
function applyToWord(word, { force }) {
  if (isInterpolation(word) || hasDeliberateCasing(word)) return word;

  if (word.includes('-')) {
    return word
      .split('-')
      .map((part, i) => (part ? applyToWord(part, { force: force || i > 0 }) : part))
      .join('-');
  }

  const bare = word.replace(/[^\p{L}\p{N}']/gu, '').toLocaleLowerCase('en');
  if (!force && MINOR_WORDS.has(bare)) return lowercaseWord(word);
  return capitalizeFirstLetter(lowercaseWord(word));
}

/**
 * Colons, em dashes, question and exclamation marks open a new clause, and
 * the word after one is treated as a first word ("Ready? Set. Go").
 */
const CLAUSE_BREAK = /[:—–?!.]$/;

/** @param {string} value @returns {string} */
export function toTitleCase(value) {
  const input = String(value ?? '');
  if (!input.trim()) return input;

  const tokens = input.split(/(\s+)/); // keep whitespace runs so spacing round-trips
  const wordIndexes = tokens.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
  const lastWordIndex = wordIndexes[wordIndexes.length - 1];

  let forceNext = true;
  return tokens
    .map((token, i) => {
      if (!token.trim()) return token;
      const force = forceNext || i === lastWordIndex;
      forceNext = CLAUSE_BREAK.test(token);
      return applyToWord(token, { force });
    })
    .join('');
}

/** @returns {boolean} true when `value` is already correct Title Case. */
export function isTitleCase(value) {
  return toTitleCase(value) === String(value ?? '');
}
