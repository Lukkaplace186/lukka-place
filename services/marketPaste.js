/**
 * "Coller des annonces" — one paste (a Facebook group, a Zwandako page, a
 * WhatsApp broadcast, any website) read into its separate adverts, each with
 * the facts the price guide needs AND the person who posted it, so the team
 * fills the market data and the prospects list in one go
 * (web /admin/market-data/marche, POST /admin/parse-market-paste).
 *
 * Nothing is stored here: the team member checks every row on the web page
 * and saves. The rules that keep the model honest are applied in code:
 *
 *  - a phone number is kept only when its digits are literally in the pasted
 *    text (the model may reformat a number, never invent one);
 *  - a commune is kept only when locations.js resolves it to one Kinshasa
 *    commune, or deduces it from a quartier that exists in one commune only;
 *  - a price is kept only when that number is in the text.
 */

const openai = require('./openai');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const { normaliseOpsNumber } = require('./opsDesk');
const locations = require('./locations');

const MAX_TEXT = 12000;
const MAX_ADVERTS = 30;

const KINDS = ['appartement', 'studio', 'maison', 'villa', 'duplex', 'penthouse', 'chambre', 'terrain', 'bureau', 'commercial', 'immeuble'];

const SYSTEM_PROMPT = `Tu lis un texte collé par l'équipe de Lukka Place (Kinshasa) : une ou plusieurs annonces immobilières copiées d'un groupe Facebook, d'un site, d'un groupe WhatsApp.

Rends UNE entrée par annonce distincte (un bien proposé). Ignore les commentaires, les demandes ("je cherche…") et le texte qui n'est pas une annonce.

Pour chaque annonce, uniquement ce qui est écrit, jamais deviné :
- purpose : "rent" (location) ou "sale" (vente), null si non dit.
- property_kind : ${KINDS.join(', ')}. "Parcelle" avec maison → maison ; sans construction → terrain. Boutique / entrepôt → commercial. null si non dit.
- beds : nombre de chambres (un salon n'est pas une chambre). null si non dit.
- price : le montant tel qu'écrit (nombre). price_text : le montant exactement comme écrit dans le texte. currency : "USD" ou "CDF".
- price_period : "mois", "an", "jour", "semaine" pour une location, "total" pour une vente.
- furnished : true si meublé, false si "non meublé", sinon null.
- commune et quartier : tels qu'écrits. Un repère (église, avenue, arrêt) n'est pas un quartier.
- contact_name : le nom de la personne qui publie ou à contacter (nom du profil Facebook si collé avec l'annonce). null si absent.
- agency_name : le nom de l'agence ou de l'entreprise immobilière, si écrit. null sinon.
- contact_phone : le numéro de téléphone ou WhatsApp écrit dans l'annonce, recopié tel quel. null si aucun.
- posted_hint : la date ou l'ancienneté si elle est écrite ("il y a 3 j", "12 octobre"), sinon null.
- title : un résumé court en français de 80 caractères maximum ("Appartement 2 ch. à Ngaliema, Mbinza Delvaux").

Le même numéro peut apparaître dans plusieurs annonces : recopie-le dans chacune.`;

const nullable = (type) => ({ type: [type, 'null'] });

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'market_paste',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['adverts'],
      properties: {
        adverts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['purpose', 'property_kind', 'beds', 'price', 'price_text', 'currency', 'price_period', 'furnished', 'commune', 'quartier', 'contact_name', 'agency_name', 'contact_phone', 'posted_hint', 'title'],
            properties: {
              purpose: { type: ['string', 'null'], enum: ['rent', 'sale', null] },
              property_kind: { type: ['string', 'null'], enum: [...KINDS, null] },
              beds: nullable('integer'),
              price: nullable('number'),
              price_text: nullable('string'),
              currency: { type: ['string', 'null'], enum: ['USD', 'CDF', null] },
              price_period: { type: ['string', 'null'], enum: ['mois', 'an', 'jour', 'semaine', 'total', null] },
              furnished: nullable('boolean'),
              commune: nullable('string'),
              quartier: nullable('string'),
              contact_name: nullable('string'),
              agency_name: nullable('string'),
              contact_phone: nullable('string'),
              posted_hint: nullable('string'),
              title: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

const digits = (s) => String(s || '').replace(/\D/g, '');

/**
 * The number as stored (243… for a DRC number, the digits otherwise), only
 * when its significant digits are in the pasted text.
 */
function verifiedPhone(raw, text) {
  const d = digits(raw);
  if (d.length < 7) return null;
  const normalised = normaliseOpsNumber(raw) || (d.length >= 7 && d.length <= 15 ? d : null);
  if (!normalised) return null;
  const inText = digits(text);
  // The last 9 digits (a DRC subscriber number) must appear as written.
  const tail = normalised.slice(-Math.min(9, normalised.length));
  return inText.includes(tail) ? normalised : null;
}

/** A price is kept only when that figure (spaces and dots ignored) is in the text. */
function verifiedPrice(price, priceText, text) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const inText = digits(text);
  const asWritten = digits(priceText);
  if (asWritten && inText.includes(asWritten)) return price;
  const plain = String(Math.round(price));
  return inText.includes(plain) ? price : null;
}

function cleanName(value, max = 80) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (!s || /^\+?[\d\s.()-]+$/.test(s)) return null; // a number is not a name
  return s.slice(0, max);
}

function placeOf(advert) {
  const commune = advert.commune ? locations.resolveCommune(advert.commune, { city: 'Kinshasa' }) : null;
  try {
    const inferred = locations.inferListingLocation({ commune, quartier: advert.quartier || null, city: 'Kinshasa' });
    return {
      commune: inferred.commune || commune || null,
      quartier: inferred.quartier || null,
      communeFromQuartier: !commune && Boolean(inferred.commune),
    };
  } catch {
    return { commune, quartier: advert.quartier || null, communeFromQuartier: false };
  }
}

function cleanAdvert(advert, text) {
  const place = placeOf(advert);
  const price = verifiedPrice(advert.price, advert.price_text, text);
  return {
    purpose: advert.purpose || null,
    property_kind: KINDS.includes(advert.property_kind) ? advert.property_kind : null,
    beds: Number.isInteger(advert.beds) && advert.beds >= 0 && advert.beds <= 30 ? advert.beds : null,
    price,
    price_unverified: price === null && Number.isFinite(advert.price),
    currency: advert.currency || 'USD',
    price_period: advert.purpose === 'sale' ? 'total' : advert.price_period || 'mois',
    furnished: typeof advert.furnished === 'boolean' ? advert.furnished : null,
    commune: place.commune,
    commune_written: advert.commune || null,
    commune_from_quartier: place.communeFromQuartier,
    quartier: place.quartier ? String(place.quartier).slice(0, 120) : null,
    contact_name: cleanName(advert.contact_name),
    agency_name: cleanName(advert.agency_name, 120),
    contact_phone: verifiedPhone(advert.contact_phone, text),
    posted_hint: advert.posted_hint ? String(advert.posted_hint).slice(0, 60) : null,
    title: String(advert.title || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

async function parseMarketPaste(rawText, { client = null } = {}) {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('text is required');
  if (text.length > MAX_TEXT) throw new Error(`text is too long (max ${MAX_TEXT})`);

  const completion = await (client || openai.getClient()).chat.completions.create({
    model: MODEL,
    temperature: 0,
    max_completion_tokens: 6000,
    prompt_cache_key: 'lukka-market-paste',
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `--- TEXTE COLLÉ ---\n${text}\n--- FIN ---` },
    ],
  });
  openai.logCallCost('market-paste', completion, MODEL);

  const choice = completion.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('Model output was truncated');
  let parsed;
  try {
    parsed = JSON.parse(choice?.message?.content || '');
  } catch {
    throw new Error('Model returned non-JSON output');
  }
  const adverts = (Array.isArray(parsed.adverts) ? parsed.adverts : []).slice(0, MAX_ADVERTS).map((a) => cleanAdvert(a, text));
  return { adverts };
}

module.exports = {
  parseMarketPaste,
  cleanAdvert,
  verifiedPhone,
  verifiedPrice,
  MAX_TEXT,
  MAX_ADVERTS,
  RESPONSE_FORMAT,
  SYSTEM_PROMPT,
};
