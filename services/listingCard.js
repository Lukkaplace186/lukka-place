/**
 * services/listingCard.js
 *
 * The summary card an agent reads before replying "OK" — rendered from the
 * STORED listing row, never from the model's prose.
 *
 * Why: the card used to be written by gpt-4o inside `whatsapp_reply`, while
 * the row was written from `extracted_data` and then corrected by code
 * (normaliseEntryCosts, commune resolution, the correction merge). Two outputs
 * of one call, each post-processed differently, can disagree — and did: "pas
 * 3+1+1 mais 2+1+1" showed the agent 2 months of garantie while 3 were stored,
 * and the agent approved the card they read. Rendering from the row makes
 * "what the agent approves" and "what gets published" the same bytes.
 *
 * The model still writes the sentence ABOVE the card (its greeting, in the
 * agent's own language) — see composeIntakeReply. Everything factual is here.
 *
 * Same template the SYSTEM_PROMPT used to ask the model for, so agents see no
 * change in shape: one line per known field, who receives each entry cost,
 * dollar amounts when the rent is monthly.
 */

const PROPERTY_TYPE_LABELS = {
  appartement: 'Appartement',
  studio: 'Studio',
  villa: 'Villa',
  maison: 'Maison',
  duplex: 'Duplex',
  chambre_salon: 'Chambre salon',
  parcelle: 'Parcelle',
  terrain: 'Terrain',
  bureau: 'Bureau',
  boutique: 'Boutique',
  entrepot: 'Entrepôt',
  immeuble: 'Immeuble',
  autre: 'Autre',
};

const SUBTYPE_LABELS = {
  maison_type_locataire: 'Maison type locataire',
  villa: 'Villa',
  terrain_nu: 'Terrain nu',
};

const MISSING_LABELS = {
  transaction_type: 'location ou vente',
  property_type: 'type de bien',
  commune: 'commune',
  price: 'prix',
  bedrooms: 'nombre de chambres',
};

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function money(amount, currency) {
  const formatted = Number(amount).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  return currency === 'CDF' ? `${formatted} FC` : currency === 'EUR' ? `${formatted} €` : `${formatted} $`;
}

function isMonthlyRent(row) {
  return row.transaction_type !== 'vente' && (row.price_period === 'mois' || !present(row.price_period)) && Number(row.price) > 0;
}

function periodSuffix(row) {
  if (row.transaction_type === 'vente' || row.price_period === 'total') return '';
  if (row.price_period === 'an') return ' / an';
  return ' / mois';
}

/** A row whose parsed extraction describes several units or properties keeps the model's itemised recap. */
function isGroupedListing(row) {
  const parsed = row?.parsed_json || {};
  return Boolean(parsed.is_multi_unit || parsed.is_multi_property);
}

/**
 * Essential fields still missing on the row. Bedrooms is not asked of a plot
 * or commercial premises, where "chambres" means nothing.
 */
function missingFields(row) {
  const noRooms = ['terrain', 'parcelle', 'bureau', 'boutique', 'entrepot'].includes(row.property_type)
    && row.parcelle_subtype !== 'maison_type_locataire'
    && row.parcelle_subtype !== 'villa';
  return Object.keys(MISSING_LABELS).filter((key) => {
    if (key === 'bedrooms' && noRooms) return false;
    if (key === 'price') return !(Number(row.price) > 0);
    return !present(row[key]);
  });
}

function entryCostLine(label, months, rent, note, currency) {
  const amount = rent ? ` (${money(months * rent, currency)})` : '';
  return `*${label}* : ${months} mois${amount} ➔ _${note}_`;
}

/**
 * @param {Object} row  services/db.js getListing() row (parsed).
 * @param {{photoCount?: number}} [options]
 * @returns {string} WhatsApp-formatted lines, one per known field.
 */
function renderListingCard(row, { photoCount } = {}) {
  if (!row) return '';
  const lines = [];
  const rent = isMonthlyRent(row) ? Number(row.price) : null;
  const currency = row.currency || 'USD';

  if (present(row.transaction_type)) lines.push(`*Type de transaction* : ${row.transaction_type === 'vente' ? 'Vente' : 'Location'}`);
  if (present(row.property_type)) lines.push(`*Catégorie de propriété* : ${PROPERTY_TYPE_LABELS[row.property_type] || row.property_type}`);
  if (row.property_type === 'parcelle' && present(row.parcelle_subtype)) {
    lines.push(`*Sous-type* : ${SUBTYPE_LABELS[row.parcelle_subtype] || row.parcelle_subtype}`);
  }
  if (present(row.commune)) lines.push(`*Commune* : ${row.commune}`);
  if (present(row.quartier)) lines.push(`*Quartier* : ${row.quartier}`);
  if (Number(row.price) > 0) {
    lines.push(`*${row.transaction_type === 'vente' ? 'Prix' : 'Loyer'}* : ${money(row.price, currency)}${periodSuffix(row)}`);
  }

  const deposit = present(row.deposit_months) ? Number(row.deposit_months) : null;
  const advance = present(row.advance_months) ? Number(row.advance_months) : null;
  const commission = present(row.commission_months) ? Number(row.commission_months) : null;
  if (deposit !== null) lines.push(entryCostLine('Garantie', deposit, rent, 'Retenu par le Bailleur, remboursable en fin de bail', currency));
  if (advance !== null) lines.push(entryCostLine("Loyer d'avance", advance, rent, 'Payable au Bailleur, couvre vos premiers mois', currency));
  if (commission === 0) lines.push("*Commission d'agence* : aucune");
  else if (commission !== null) lines.push(entryCostLine("Commission d'agence", commission, rent, "Payable à l'Agent / Agence, frais de courtage", currency));
  const known = [deposit, advance, commission].filter((v) => v !== null);
  if (known.length >= 2) {
    const total = known.reduce((sum, v) => sum + v, 0);
    lines.push(`*Total à prévoir à l'entrée* : ${total} mois${rent ? ` (${money(total * rent, currency)})` : ''}`);
  }

  if (present(row.bedrooms)) lines.push(`*Chambres* : ${row.bedrooms}`);
  if (present(row.bathrooms)) lines.push(`*Salles de bain* : ${row.bathrooms}`);
  if (present(row.units_count)) lines.push(`*Nombre de portes* : ${row.units_count}`);
  if (Number(row.surface_area_sqm) > 0) lines.push(`*Superficie* : ${Number(row.surface_area_sqm).toLocaleString('fr-FR')} m²`);
  const amenities = asList(row.amenities).filter(Boolean);
  if (amenities.length) lines.push(`*Équipements* : ${amenities.join(', ')}`);
  if (present(row.reference)) lines.push(`*Référence* : ${row.reference}`);

  const photos = photoCount ?? asList(row.photos).length;
  lines.push(photos > 0 ? `*Photos* : ${photos}` : '*Photos* : aucune — envoyez au moins une photo du bien');
  return lines.join('\n');
}

/**
 * The model's own opening sentence(s) — everything before its first card
 * line — so the greeting keeps the agent's language while the facts come
 * from the row. A reply that opens straight on the card yields the default.
 */
function introFrom(modelReply, fallback) {
  const lines = String(modelReply || '').split('\n');
  const intro = [];
  for (const line of lines) {
    // A card line is "*Label* : value"; a bold headline ("*Annonce reçue* ✅") is not.
    if (/^\s*(?:[-•]\s*)?\*[^*]+\*\s*:/.test(line)) break;
    intro.push(line);
  }
  // The closing instruction is ours (composeIntakeReply); the model's own copy would repeat it.
  const text = intro.filter((line) => !/r[ée]pondez|ok.{0,3}pour publier/i.test(line)).join('\n').trim();
  if (!text) return fallback;
  // No card in the reply at all: a short line ("Annonce reçue !") is still a
  // greeting; a long one is prose that may restate facts, so it is dropped in
  // favour of the card.
  if (intro.length === lines.length) return text.length <= 200 ? text : fallback;
  return text.length > 400 ? fallback : text;
}

/**
 * The full intake reply: model greeting + card from the row + what is still
 * missing + what to do next.
 *
 * @param {string} modelReply
 * @param {Object} row
 * @param {{mode?: 'draft'|'published'|'onboarding', photoCount?: number}} [options]
 */
function composeIntakeReply(modelReply, row, { mode = 'draft', photoCount } = {}) {
  const published = mode === 'published';
  const intro = introFrom(
    modelReply,
    published ? 'Votre annonce a été mise à jour :' : 'Voici la fiche de votre bien :',
  );
  const parts = [intro, renderListingCard(row, { photoCount })];

  const missing = missingFields(row);
  if (missing.length) {
    parts.push(`Il manque : ${missing.map((key) => MISSING_LABELS[key]).join(', ')}. Envoyez-les quand vous pouvez.`);
  }
  // 'onboarding': the registration question that follows IS the confirmation
  // for a sender with no account, so asking for "OK" too would be one
  // acknowledgement too many (services/agentOnboarding.js).
  if (mode !== 'onboarding') {
    parts.push(
      published
        ? 'Elle est déjà en ligne avec ces informations. Envoyez une autre correction si besoin.'
        : 'Tout est juste ? Répondez *OK* pour publier. Sinon, écrivez simplement la correction (ex. : « non, c’est 570$ »).',
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

module.exports = {
  renderListingCard,
  composeIntakeReply,
  introFrom,
  missingFields,
  isGroupedListing,
};
