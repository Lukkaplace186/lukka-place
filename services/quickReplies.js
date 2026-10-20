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

/**
 * A passive acknowledgment — "d'accord", "ok merci", "super 👍". Nothing is
 * asked, so nothing is answered (launch feedback, 2026-10-20: an agent
 * replying "D'accord" got a second bot message asking for a listing). Any run
 * of these words with punctuation or emoji between them; emoji alone counts
 * too. Only reached with no draft pending and no open question
 * (routes/webhook.js), so an "OK" that publishes never gets here.
 */
const ACK_WORD = String.raw`(?:d'?\s*accord|dacc?|ok+|okay|oki|okey|merci(?:\s*beaucoup|\s*bien)?|mercii+|thanks?|thank\s*you|matondo(?:\s*mingi)?|c'?\s*est\s*(?:bon|note|compris|clair|parfait)|super|parfait|top|cool|genial|bien\s*recu|recu|entendu|compris|note|ca\s*marche|tres\s*bien|oui|yes|ouais|bien)`;
const ACK_PATTERN = new RegExp(
  String.raw`^(?:${ACK_WORD}[\s!.,;: -㌀\u{1F000}-\u{1FAFF}️‍]*)+$`,
  'iu',
);
const EMOJI_ONLY_PATTERN = /^[\s -㌀\u{1F000}-\u{1FAFF}️‍]+$/u;

/**
 * "Comment se passe l'inscription ?", "c'est gratuit ?", "comment ça marche" —
 * asked by agents who saw the launch message. Answered with the real steps and
 * the signup link instead of the model's improvised prose. Never a message
 * that names a property, a price or a search: that is for the model.
 */
const SIGNUP_PATTERN = new RegExp(
  String.raw`(?:inscri|enregistr|rejoindre|adherer|(?:creer|ouvrir|faire)\s+(?:un|mon|le|son)\s+compte`
  + String.raw`|comment\s+(?:ca|cela)\s+(?:marche|fonctionne|se\s+passe)|comment\s+(?:faire|proceder|publier|commencer|on\s+fait|je\s+fais)`
  + String.raw`|(?:c'?\s*est|est[-\s]ce)\s+(?:gratuit|payant)|gratuit\s*\?|payant\s*\?|combien\s+(?:ca|cela)\s+coute|tarif|abonnement)`,
  'i',
);
const LISTING_OR_SEARCH_PATTERN =
  /(?:\blouer\b|\bloue\b|\bvendre\b|\bvente\b|location|chambre|appart|maison|villa|terrain|parcelle|studio|duplex|bureau|boutique|entrepot|depot|immeuble|je\s+cherche|\$|\busd\b|\bfc\b|dollar)/i;
const MAX_SIGNUP_QUESTION_LENGTH = 200;

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

const SIGNUP_URL = 'https://lukkaplace.com/compte/agent/inscription';
const SUPPORT_NUMBER = '+243 846 962 654';

const SIGNUP_REPLY =
  'Bienvenue sur *Lukka Place* 👋 Agents et commissionnaires : *2 mois gratuits*.\n\n'
  + '*Deux façons de vous inscrire :*\n'
  + '1️⃣ Ici sur WhatsApp : envoyez votre première annonce (photos + type de bien, commune, prix, chambres). '
  + 'Nous vous demandons ensuite votre nom et celui de votre agence, et votre compte est créé.\n'
  + `2️⃣ Sur le site : ${SIGNUP_URL}\n\n`
  + `Une question ? Notre équipe : ${SUPPORT_NUMBER}`;

/** What a message that is not a listing gets instead of the model's own prose (routes/webhook.js). */
const FALLBACK_REPLY =
  'Pour publier un bien, envoyez-le ici en un seul message : *photos* + type de bien, commune, prix et chambres. '
  + 'Je vous renvoie une fiche à valider avec *OK*.\n\n'
  + `Pour créer votre compte : ${SIGNUP_URL}\n`
  + `Pour toute autre question, notre équipe : ${SUPPORT_NUMBER}`;

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
 * @returns {{kind: 'greeting'|'help'|'ack'|'signup', reply: string|null}|null}
 *          null means "not a quick reply" — let the model handle it. An
 *          'ack' carries `reply: null`: say nothing.
 */
function matchQuickReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // A signup question is longer than a greeting: its own ceiling, and its own
  // guard against anything naming a property, a price or a search.
  if (raw.length <= MAX_SIGNUP_QUESTION_LENGTH && !/\d/.test(raw)) {
    const folded = normalise(raw).replace(/[’`]/g, "'");
    if (SIGNUP_PATTERN.test(folded) && !LISTING_OR_SEARCH_PATTERN.test(folded)) {
      return { kind: 'signup', reply: SIGNUP_REPLY };
    }
  }

  if (raw.length > MAX_QUICK_REPLY_LENGTH) return null;

  // A message containing a number is never a bare greeting — it is a price, a
  // room count or a phone number, i.e. real content.
  if (/\d/.test(raw)) return null;

  const normalised = normalise(raw);

  if (HELP_PATTERN.test(normalised)) return { kind: 'help', reply: HELP_REPLY };
  if (GREETING_PATTERN.test(normalised)) return { kind: 'greeting', reply: GREETING_REPLY };
  if (ACK_PATTERN.test(normalised.replace(/[’`]/g, "'")) || EMOJI_ONLY_PATTERN.test(raw)) {
    return { kind: 'ack', reply: null };
  }

  return null;
}

module.exports = {
  matchQuickReply,
  GREETING_REPLY,
  HELP_REPLY,
  SIGNUP_REPLY,
  FALLBACK_REPLY,
  SIGNUP_URL,
  SUPPORT_NUMBER,
  MAX_SIGNUP_QUESTION_LENGTH,
  MAX_QUICK_REPLY_LENGTH,
};
