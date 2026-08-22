/**
 * services/aiParser.js
 *
 * Single-pass property extraction for Lukka Place.
 *
 * Agents in Kinshasa send listings to WhatsApp as free-form French / Lingala
 * text, often mixed, often with photos and no structure at all. One Gemini call
 * turns that mess into a typed listing object — text and images go in together
 * so the model can read a price off a flyer photo or count rooms from a picture
 * in the same pass.
 */

const { GoogleGenAI, Type } = require('@google/genai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let client;

/**
 * Lazily build the client so the module can be required (and unit-tested)
 * without GEMINI_API_KEY being present.
 */
function getClient() {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is missing — set it in .env');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

/**
 * The 24 communes of Kinshasa, given to the model so it can normalise the
 * spellings agents actually type ("gombé", "Ngaliema/Ma Campagne", "Bandal").
 */
const KINSHASA_COMMUNES = [
  'Bandalungwa', 'Barumbu', 'Bumbu', 'Gombe', 'Kalamu', 'Kasa-Vubu',
  'Kimbanseke', 'Kinshasa', 'Kintambo', 'Kisenso', 'Lemba', 'Limete',
  'Lingwala', 'Makala', 'Maluku', 'Masina', 'Matete', 'Mont-Ngafula',
  'Ndjili', 'Ngaba', 'Ngaliema', 'Ngiri-Ngiri', 'Nsele', 'Selembao',
];

const SYSTEM_INSTRUCTION = `Tu es l'analyste immobilier de Lukka Place, une plateforme proptech à Kinshasa (République Démocratique du Congo).

Ton rôle : extraire une annonce immobilière structurée à partir de messages WhatsApp bruts envoyés par des agents immobiliers, puis la retourner en JSON strict conforme au schéma fourni.

CONTEXTE LINGUISTIQUE
- Les messages sont en français, en lingala, ou en mélange des deux (souvent avec de l'argot kinois, des abréviations et des fautes de frappe).
- Vocabulaire courant : "à louer" / "kolo futa" (location), "à vendre" (vente), "parcelle" (terrain/lot), "villa", "appartement", "studio", "maison basse", "duplex", "chambre salon", "salon + chambres", "dépendance", "annexe", "boutique", "entrepôt", "bureau".
- "pièces" désigne généralement le total des pièces, PAS le nombre de chambres. Si l'annonce dit "chambre salon", c'est 1 chambre.
- "SB" / "s. bain" = salle de bain. "WC" = toilettes. "clim" = climatisation. "forage" = puits d'eau. "SNEL" = électricité du réseau. "REGIDESO" = eau du réseau.

CONTEXTE MONÉTAIRE
- À Kinshasa, les loyers et les prix de vente sont presque toujours cotés en dollars américains (USD). "$", "usd", "dollars" => USD.
- "FC", "CDF", "francs" => CDF (franc congolais).
- Si aucune devise n'est indiquée et que le montant est plausible en USD, utilise USD.
- Sépare bien le loyer mensuel du prix de vente. "500$/mois" => loyer mensuel 500 USD. Une caution ("garantie", "3 mois de caution") n'est PAS le loyer.

LOCALISATION
- Les 24 communes de Kinshasa : ${KINSHASA_COMMUNES.join(', ')}.
- Normalise la commune vers l'une de ces orthographes exactes lorsque tu la reconnais (ex. "gombé" => "Gombe", "Bandal" => "Bandalungwa", "Djili" => "Ndjili").
- Mets le repère de quartier plus fin ("Ma Campagne", "Righini", "Kingabwa", "Socimat", "Super Lemba", "UPN", "Pompage") dans "quartier", pas dans "commune".

IMAGES
- Si des images sont fournies, lis tout texte visible (flyer, capture d'écran, pancarte) et sers-t'en pour compléter ou corriger le texte du message.
- Tu peux déduire des équipements clairement visibles (piscine, jardin, carrelage, étage). Ne devine JAMAIS un prix, une surface ou une adresse à partir d'une photo seule.

RÈGLES D'EXTRACTION — IMPORTANT
1. N'invente rien. Tout champ absent du message doit être null (ou [] pour les listes). Une annonce partielle est normale et acceptable.
2. Ne convertis pas les devises. Rapporte le montant et la devise tels qu'ils apparaissent.
3. "confidence" reflète ta certitude globale sur l'extraction : 0.9+ pour une annonce claire et complète, ~0.5 pour un message vague, <0.3 si ce n'est probablement pas une annonce du tout.
4. "is_listing" doit être false pour les salutations, questions, demandes de client ("je cherche un studio"), ou bavardages. Dans ce cas, remplis "intent" et laisse les champs de l'annonce vides.
5. "missing_fields" liste les champs essentiels manquants, à demander à l'agent : parmi "transaction_type", "property_type", "commune", "price", "bedrooms".
6. "summary_fr" : une phrase de résumé en français, prête à être relue par l'agent pour confirmation.
7. Conserve le texte original de l'agent dans "raw_notes" pour tout détail utile qui ne rentre dans aucun champ (conditions de visite, disponibilité, nom du propriétaire).`;

/**
 * Response schema — Gemini is forced into this shape, so the caller never has
 * to guard against malformed JSON or renamed keys.
 */
const LISTING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    is_listing: {
      type: Type.BOOLEAN,
      description: 'true si le message décrit un bien à louer ou à vendre.',
    },
    intent: {
      type: Type.STRING,
      enum: ['listing', 'buyer_request', 'question', 'greeting', 'other'],
      description: "Intention du message de l'agent.",
    },
    transaction_type: {
      type: Type.STRING,
      nullable: true,
      enum: ['location', 'vente', 'unknown'],
    },
    property_type: {
      type: Type.STRING,
      nullable: true,
      enum: [
        'appartement', 'studio', 'villa', 'maison', 'duplex', 'chambre_salon',
        'parcelle', 'terrain', 'bureau', 'boutique', 'entrepot', 'immeuble', 'autre',
      ],
    },
    commune: { type: Type.STRING, nullable: true, description: 'Commune de Kinshasa, orthographe normalisée.' },
    quartier: { type: Type.STRING, nullable: true, description: 'Quartier ou repère précis.' },
    city: { type: Type.STRING, nullable: true, description: 'Ville. "Kinshasa" par défaut si le contexte le confirme.' },
    address_hint: { type: Type.STRING, nullable: true, description: 'Avenue, numéro ou repère tel qu\'écrit.' },
    price: { type: Type.NUMBER, nullable: true, description: 'Montant principal : loyer mensuel si location, prix si vente.' },
    currency: { type: Type.STRING, nullable: true, enum: ['USD', 'CDF', 'EUR'] },
    price_period: {
      type: Type.STRING,
      nullable: true,
      enum: ['mois', 'an', 'total'],
      description: '"mois" pour un loyer mensuel, "total" pour un prix de vente.',
    },
    deposit_months: { type: Type.INTEGER, nullable: true, description: 'Nombre de mois de caution/garantie exigés.' },
    negotiable: { type: Type.BOOLEAN, nullable: true },
    bedrooms: { type: Type.INTEGER, nullable: true, description: 'Nombre de chambres (pas le total des pièces).' },
    bathrooms: { type: Type.INTEGER, nullable: true },
    total_rooms: { type: Type.INTEGER, nullable: true, description: 'Nombre total de pièces si mentionné ("X pièces").' },
    surface_area_sqm: { type: Type.NUMBER, nullable: true, description: 'Superficie en m². Convertis les dimensions (ex. "20x30" => 600).' },
    floor: { type: Type.STRING, nullable: true, description: 'Étage ou niveau ("rez-de-chaussée", "2ème").' },
    furnished: { type: Type.BOOLEAN, nullable: true },
    amenities: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Équipements cités : piscine, forage, groupe électrogène, climatisation, parking, jardin, sécurité, SNEL, REGIDESO, ascenseur...',
    },
    availability: { type: Type.STRING, nullable: true, description: 'Disponibilité telle qu\'annoncée ("libre de suite", "à partir de septembre").' },
    contact_name: { type: Type.STRING, nullable: true },
    contact_phone: { type: Type.STRING, nullable: true, description: 'Numéro cité DANS le message (différent de l\'expéditeur).' },
    summary_fr: { type: Type.STRING, description: 'Résumé en une phrase, en français, pour confirmation par l\'agent.' },
    detected_languages: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: ['fr', 'ln', 'sw', 'en', 'other'] },
      description: 'Langues détectées dans le message.',
    },
    missing_fields: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: ['transaction_type', 'property_type', 'commune', 'price', 'bedrooms'] },
      description: 'Champs essentiels manquants à réclamer à l\'agent.',
    },
    raw_notes: { type: Type.STRING, nullable: true, description: 'Détails utiles ne rentrant dans aucun champ.' },
    confidence: { type: Type.NUMBER, description: 'Confiance globale entre 0 et 1.' },
  },
  required: ['is_listing', 'intent', 'summary_fr', 'amenities', 'detected_languages', 'missing_fields', 'confidence'],
  propertyOrdering: [
    'is_listing', 'intent', 'transaction_type', 'property_type', 'commune',
    'quartier', 'city', 'address_hint', 'price', 'currency', 'price_period',
    'deposit_months', 'negotiable', 'bedrooms', 'bathrooms', 'total_rooms',
    'surface_area_sqm', 'floor', 'furnished', 'amenities', 'availability',
    'contact_name', 'contact_phone', 'summary_fr', 'detected_languages',
    'missing_fields', 'raw_notes', 'confidence',
  ],
};

/**
 * Run the single-pass extraction.
 *
 * @param {Object}   input
 * @param {string}   [input.text]     Message body / image caption from the agent.
 * @param {Array<{data: string, mimeType: string}>} [input.images]
 *        Inline images (base64, no data-URI prefix) — e.g. from
 *        `whatsapp.downloadMedia()`.
 * @param {string}   [input.senderPhone] Sender's wa_id, used only as context.
 * @returns {Promise<Object>} Listing object matching LISTING_SCHEMA, plus a
 *          `_meta` field with model and token usage.
 */
async function parseListing({ text, images = [], senderPhone } = {}) {
  const hasText = Boolean(text && text.trim());

  if (!hasText && images.length === 0) {
    throw new Error('parseListing requires text, images, or both');
  }

  const parts = [];

  parts.push({
    text: [
      "Analyse ce message WhatsApp d'un agent immobilier et retourne l'annonce structurée en JSON.",
      senderPhone ? `Expéditeur (wa_id) : ${senderPhone}` : null,
      images.length
        ? `Le message contient ${images.length} image(s) ci-joint(es) — lis tout texte visible.`
        : null,
      '',
      hasText ? `--- MESSAGE ---\n${text.trim()}\n--- FIN DU MESSAGE ---` : '--- AUCUN TEXTE, IMAGES UNIQUEMENT ---',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  for (const image of images) {
    parts.push({
      inlineData: { data: image.data, mimeType: image.mimeType },
    });
  }

  const response = await getClient().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: LISTING_SCHEMA,
      // Extraction, not creative writing — keep it deterministic.
      temperature: 0,
    },
  });

  const raw = response.text;
  if (!raw) {
    // Most often a safety block or an empty candidate.
    const reason = response.candidates?.[0]?.finishReason || 'unknown';
    throw new Error(`Gemini returned no text (finishReason: ${reason})`);
  }

  let listing;
  try {
    listing = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON output: ${raw.slice(0, 200)}`);
  }

  listing._meta = {
    model: MODEL,
    imageCount: images.length,
    usage: response.usageMetadata || null,
  };

  return listing;
}

module.exports = {
  parseListing,
  LISTING_SCHEMA,
  SYSTEM_INSTRUCTION,
  KINSHASA_COMMUNES,
};
