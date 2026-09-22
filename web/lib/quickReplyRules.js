import { formatPrice, usablePrice } from './format';
import { entryTerms } from './listingView';
import { isPhoneLikeName } from './agentIdentity';
import { SITE_URL } from './constants';

/**
 * Quick replies — the agent's saved WhatsApp messages. Pure and client-safe:
 * the sheet on a lead card renders a template against a listing in the
 * browser, and the server validates what an agent saves with the same rules.
 *
 * The messages are FRENCH ON PURPOSE, whatever the dashboard language: they
 * are sent to the agent's customers, the same reason lib/listingShareCopy.js
 * writes its caption in French. Only the dashboard chrome around them is
 * translated. Once an agent edits a template it is their own text (data), and
 * is never translated either.
 *
 * Defaults are rendered from DEFAULT_QUICK_REPLIES until the agent changes
 * anything; lib/quickReplies.js copies them into the agent's own rows at that
 * moment. They are never inserted for every agent up front.
 */

export const QUICK_REPLY_TITLE_MAX = 60;
export const QUICK_REPLY_BODY_MAX = 1000;
export const QUICK_REPLY_MAX_PER_AGENT = 20;

/**
 * Placeholders a template may use. Every value comes from the real listing
 * (or, for {client_name}, the real lead) — see quickReplyFacts.
 */
export const QUICK_REPLY_PLACEHOLDERS = [
  'client_name',
  'listing_title',
  'price',
  'commune',
  'quartier',
  'deposit',
  'link',
];

/*
 * `key` is stable: it is what a customised copy remembers
 * (agent_quick_replies.default_key), so the same default is never copied in
 * twice. Wording keeps each fact on its own line so that a listing missing
 * that fact loses the line, not the whole message.
 */
export const DEFAULT_QUICK_REPLIES = [
  {
    key: 'available_visit',
    title: 'Disponible — proposer une visite',
    body:
      'Bonjour,\n' +
      'Oui, le bien « {listing_title} » est toujours disponible.\n' +
      'Je vous propose une visite demain à … Quelle heure vous arrange ?',
  },
  {
    key: 'already_taken',
    title: 'Déjà loué / vendu',
    body:
      'Bonjour,\n' +
      'Merci pour votre intérêt. Le bien « {listing_title} » n’est malheureusement plus disponible.\n' +
      'Je peux vous proposer d’autres biens à {commune}.\n' +
      'Quel est votre budget ?',
  },
  {
    key: 'entry_terms',
    title: 'Conditions d’entrée',
    body:
      'Voici les conditions pour « {listing_title} » :\n' +
      'Prix : {price}\n' +
      'Garantie : {deposit}\n' +
      'N’hésitez pas si vous avez des questions.',
  },
  {
    key: 'visit_documents',
    title: 'Documents pour la signature',
    body:
      'Bonjour,\n' +
      'Pour la signature, merci de prévoir une pièce d’identité.\n' +
      'Garantie demandée : {deposit}',
  },
  {
    key: 'listing_link',
    title: 'Envoyer le lien de l’annonce',
    body: 'Voici l’annonce avec toutes les photos :\n{link}',
  },
];

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

/**
 * The placeholder values for one listing (+ optionally one lead). A value is
 * `null` when the data does not support it, and a null makes renderQuickReply
 * drop the line — never print "{price}" or an invented figure.
 *
 * - {price}: the real stored USD price through formatPrice, or null when the
 *   listing has none (formatPrice's "Prix sur demande" is a UI label, not a
 *   price to quote a customer).
 * - {deposit}: entryTerms' "3 + 1 + 1" notation, rental only; null when no
 *   deposit is stated (NULL means "not stated", not "none").
 * - {link}: only for a listing that is actually public
 *   (status = 1 AND approve_status = 1) — a link to a pending listing 404s.
 * - {client_name}: the lead's name, never its phone digits.
 *
 * @param {object|null} listing  a row from lib/quickReplies.js's getQuickReplyListings
 * @param {{name?: string|null}} [lead]
 */
export function quickReplyFacts(listing, lead = null) {
  const leadName = String(lead?.name ?? '').trim();
  const facts = {
    client_name: leadName && !isPhoneLikeName(leadName) ? leadName : null,
    listing_title: null,
    price: null,
    commune: null,
    quartier: null,
    deposit: null,
    link: null,
  };
  if (!listing) return facts;

  const title = String(listing.title ?? '').trim();
  facts.listing_title = title || null;
  facts.price = usablePrice(listing.price) === null ? null : formatPrice(listing.price, listing.purpose, listing.price_period);
  facts.commune = String(listing.commune ?? '').trim() || null;
  facts.quartier = String(listing.quartier ?? '').trim() || null;
  if (listing.purpose === 'rent') {
    const terms = entryTerms(listing);
    if (terms) facts.deposit = `${terms.parts.join(' + ')} mois`;
  }
  if (listing.is_public && listing.id != null) facts.link = `${SITE_URL}/listings/${listing.id}`;
  return facts;
}

/**
 * Fills a template line by line. A line holding any placeholder that has no
 * value — or that is not a known placeholder at all — is dropped whole, so a
 * listing with no deposit loses "Garantie : {deposit}" instead of sending
 * "Garantie : {deposit}" or "Garantie : ". Blank runs left behind collapse to
 * one blank line.
 *
 * @returns {{text: string, dropped: string[]}} `dropped` lists the placeholders
 *   that removed a line, so the sheet can say what was left out.
 */
export function renderQuickReply(body, facts = {}) {
  const dropped = new Set();
  const kept = [];
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const names = [...line.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
    const missing = names.filter((name) => {
      const value = facts[name];
      return value === null || value === undefined || String(value).trim() === '';
    });
    if (missing.length) {
      missing.forEach((name) => dropped.add(name));
      continue;
    }
    kept.push(line.replace(PLACEHOLDER_RE, (_, name) => String(facts[name]).trim()));
  }

  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, dropped: [...dropped] };
}

/**
 * What an agent may save. Returns an i18n key on refusal (the caller
 * translates), never a raw string, so this module stays free of the
 * dictionary.
 *
 * @returns {{ok: true, title: string, body: string} | {ok: false, errorKey: string}}
 */
export function validateQuickReply({ title, body }) {
  const cleanTitle = String(title ?? '').replace(/\s+/g, ' ').trim();
  const cleanBody = String(body ?? '').replace(/\r\n/g, '\n').trim();
  if (!cleanTitle) return { ok: false, errorKey: 'agent.quickReplies.errors.titleRequired' };
  if (cleanTitle.length > QUICK_REPLY_TITLE_MAX) return { ok: false, errorKey: 'agent.quickReplies.errors.titleTooLong' };
  if (!cleanBody) return { ok: false, errorKey: 'agent.quickReplies.errors.bodyRequired' };
  if (cleanBody.length > QUICK_REPLY_BODY_MAX) return { ok: false, errorKey: 'agent.quickReplies.errors.bodyTooLong' };
  const unknown = [...cleanBody.matchAll(PLACEHOLDER_RE)]
    .map((m) => m[1])
    .find((name) => !QUICK_REPLY_PLACEHOLDERS.includes(name));
  if (unknown) return { ok: false, errorKey: 'agent.quickReplies.errors.unknownPlaceholder' };
  return { ok: true, title: cleanTitle, body: cleanBody };
}

/** wa.me wants digits only; a lead's wa_id already is, but never trust it blindly. */
export function whatsappDigits(waId) {
  const digits = String(waId ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}
