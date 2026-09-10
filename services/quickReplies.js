/**
 * services/quickReplies.js
 *
 * Messages worth answering without asking gpt-4o.
 *
 * WHY
 * ---
 * A two-letter "hi" was costing a full extraction call: the whole system
 * prompt — commune/quartier hierarchy, classification rules, reply template —
 * went to the model so it could answer "hello". Measured on production traffic:
 * ~4,850 tokens and several seconds of latency per greeting, for a reply that
 * never varies.
 *
 * These are deliberately NARROW, in exactly the same spirit as
 * routes/webhook.js's AFFIRMATIVE_PATTERN: a short, whole-message match and
 * nothing else. Anything carrying real content — "bonjour, villa à louer
 * Gombe 1500$" — must fall through to the model, because a canned greeting
 * would throw away a listing. When in doubt, this module returns null and the
 * expensive-but-correct path runs.
 *
 * Pure functions over a string: no I/O, no db, no state.
 */

/**
 * Greetings in the languages this number actually receives — French, Lingala,
 * Swahili and English, since Kinshasa agents mix all four. Anchored whole-
 * message with only punctuation, an emoji or a name allowed to trail
 * ("bonjour Lukka !", "mbote 👋").
 */
const GREETING_PATTERN = new RegExp(
  '^(?:'
    + 'bonjour|bonsoir|bjr|bsr|salut|coucou|cc'          // French
    + '|mbote|boni|sango\\s*nini|losako'                  // Lingala
    + '|mambo|jambo|habari'                               // Swahili
    + '|hi|hey|hello|hallo|yo|good\\s*(?:morning|afternoon|evening)' // English
  + ')'
  // An optional trailing address — "bonjour lukka", "hi lukka place", "mbote
  // team" — but nothing longer, so a greeting that carries a listing behind it
  // still reaches the model.
  + '(?:\\s+(?:lukka(?:\\s*place)?|team|admin))?'
  + '[\\s!.,?\\u2000-\\u3300\\u{1F000}-\\u{1FAFF}]*$',
  'iu',
);

/** Explicit asks for help. `/aide` and `/help` included, since agents who have
 *  used other bots try slash commands first. */
const HELP_PATTERN = /^[/!]?\s*(?:aide|help|menu|info|infos|commandes?|quoi\s*faire)[\s!.?]*$/i;

/** Someone thanking us. Answering warmly costs nothing; a model call does. */
const THANKS_PATTERN =
  /^(?:merci(?:\s*beaucoup)?|mercii+|thanks?|thank\s*you|ok\s*merci|matondo)[\s!.]*$/i;

const GREETING_REPLY =
  'Bonjour 👋 Bienvenue sur *Lukka Place*.\n\n'
  + "Envoyez-moi votre annonce en un seul message — texte, photos, ou les deux — et je la structure pour vous.\n\n"
  + 'Exemple :\n'
  + '_Villa à louer Ngaliema, Macampagne, 3 chambres, 2 salles de bain, 1500$/mois, garantie 3+1+1_\n\n'
  + "N'oubliez pas au moins une *photo* 📸 : elle est obligatoire pour publier.";

const HELP_REPLY =
  '*Lukka Place — comment ça marche* 📌\n\n'
  + '1️⃣ Envoyez votre annonce (texte et/ou photos). Je vous renvoie une fiche structurée.\n'
  + '2️⃣ Corrigez ce que vous voulez, autant de fois que nécessaire — _"non, 1100$"_, _"4 chambres"_.\n'
  + '3️⃣ Répondez *OK* pour publier.\n\n'
  + 'Autres possibilités :\n'
  + '• Plusieurs appartements dans le même immeuble ? Envoyez-les d\'un coup, je crée une annonce par typologie.\n'
  + '• Bien loué ou vendu ? Écrivez _"c\'est loué"_ ou _"c\'est vendu"_.\n'
  + '• Besoin d\'un humain ? Écrivez _"je veux parler à quelqu\'un"_.\n\n'
  + 'Au moins une *photo* est obligatoire pour publier. 📸';

const THANKS_REPLY =
  'Avec plaisir ! 🙌 Envoyez-moi votre prochaine annonce quand vous voulez.';

/** Strip accents so "salut" and "sàlut" match alike — same helper shape as
 *  routes/webhook.js's normaliseForMatch. */
function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Longest message we will even consider answering from a template.
 *
 * A hard length ceiling on top of the anchored patterns: a listing is never
 * this short, so nothing with real content can be swallowed even if a pattern
 * were later loosened by mistake.
 */
const MAX_QUICK_REPLY_LENGTH = 40;

/**
 * @param {string} text
 * @returns {{kind: 'greeting'|'help'|'thanks', reply: string}|null}
 *          null means "not a quick reply" — let the model handle it.
 */
function matchQuickReply(text) {
  const raw = String(text || '').trim();
  if (!raw || raw.length > MAX_QUICK_REPLY_LENGTH) return null;

  // A message containing a number is never a bare greeting — it is a price, a
  // room count or a phone number, i.e. real content.
  if (/\d/.test(raw)) return null;

  const normalised = normalise(raw);

  if (HELP_PATTERN.test(normalised)) return { kind: 'help', reply: HELP_REPLY };
  if (GREETING_PATTERN.test(normalised)) return { kind: 'greeting', reply: GREETING_REPLY };
  if (THANKS_PATTERN.test(normalised)) return { kind: 'thanks', reply: THANKS_REPLY };

  return null;
}

module.exports = {
  matchQuickReply,
  GREETING_REPLY,
  HELP_REPLY,
  THANKS_REPLY,
  MAX_QUICK_REPLY_LENGTH,
};
