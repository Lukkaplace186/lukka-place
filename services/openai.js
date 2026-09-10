/**
 * services/openai.js
 *
 * Single-pass listing extraction with gpt-4o Structured Outputs.
 *
 * Agents in Kinshasa send listings as free-form French / Lingala text, often
 * mixed, often with no structure at all. One call returns both the typed listing
 * (`extracted_data`) and the French message to send back to the agent
 * (`whatsapp_reply`) — no second call, and no reply-formatting code to maintain.
 */

const OpenAI = require('openai');

const { LOCATIONS, COMMUNES: KINSHASA_COMMUNES } = require('./locations');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

let client;

/**
 * Lazily build the client so this module can be required (and unit-tested)
 * without OPENAI_API_KEY being present.
 */
function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is missing — set it in .env');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * Commune -> quartier hierarchy (kinshasa_locations.json, via
 * services/locations.js), rendered compactly so the model can normalise both
 * the commune AND the finer quartier spellings agents actually type
 * ("gombé", "Bandal", "Djili", "Ma Campagne").
 */
const LOCATIONS_BLOCK = Object.entries(LOCATIONS)
  .map(([commune, quartiers]) => `- ${commune} : ${quartiers.join(', ')}`)
  .join('\n');

const PROPERTY_TYPES = [
  'appartement', 'studio', 'villa', 'maison', 'duplex', 'chambre_salon',
  'parcelle', 'terrain', 'bureau', 'boutique', 'entrepot', 'immeuble', 'autre',
];

/**
 * Sub-classification of a "parcelle" listing — only meaningful (and only ever
 * populated) when property_type is 'parcelle'. Kept separate from the
 * top-level PROPERTY_TYPES enum rather than folded into it: 'villa' and
 * 'terrain' remain valid standalone property_types for a listing with no
 * plot/compound signal at all (see the classification rules below), so
 * collapsing them here would be a breaking, not additive, change.
 */
const PARCELLE_SUBTYPES = ['maison_type_locataire', 'villa', 'terrain_nu'];

const MISSING_FIELD_KEYS = ['transaction_type', 'property_type', 'commune', 'price', 'bedrooms'];

const SYSTEM_PROMPT = `Tu es l'analyste immobilier de Lukka Place, une plateforme proptech à Kinshasa (République Démocratique du Congo).

Ton rôle : à partir d'un message WhatsApp brut envoyé par un agent immobilier, produire (1) une annonce structurée et (2) la réponse WhatsApp à renvoyer à cet agent.

CONTEXTE LINGUISTIQUE
- Les messages sont en français, en lingala, ou en mélange des deux (argot kinois, abréviations, fautes de frappe).
- Vocabulaire courant : "à louer" / "kolo futa" (location), "à vendre" (vente), "parcelle" (terrain/lot), "villa", "appartement", "studio", "maison basse", "duplex", "chambre salon", "dépendance", "annexe", "boutique", "entrepôt", "bureau".
- "pièces" désigne le total des pièces, PAS le nombre de chambres. "chambre salon" = 1 chambre.
- "SB" / "s. bain" = salle de bain. "WC" = toilettes. "clim" = climatisation. "forage" = puits d'eau. "SNEL" = électricité du réseau. "REGIDESO" = eau du réseau.

CONTEXTE MONÉTAIRE
- À Kinshasa, loyers et prix de vente sont presque toujours cotés en dollars américains. "$", "usd", "dollars" => USD. "FC", "CDF", "francs" => CDF.
- Si aucune devise n'est indiquée et que le montant est plausible en USD, utilise USD.
- Sépare le loyer mensuel du prix de vente : "500$/mois" => price 500, price_period "mois". Une vente => price_period "total".
- Une caution ("garantie", "3 mois de caution") n'est PAS le loyer : mets-la dans deposit_months.

CONDITIONS D'ENTRÉE — NOTATION "3 + 1 + 1" (convention immobilière de Kinshasa)
- "Garantie : 3 + 1 + 1", "3+1+1", "GARANTIE 4+1", "3 mois garantie + 1 avance + 1 commission" : ces nombres sont des POSTES DISTINCTS. Ne les additionne JAMAIS dans deposit_months — "3 + 1 + 1" ne veut PAS dire 5 mois de garantie.
  * 1er nombre => deposit_months : la garantie locative seule (caution restituable en fin de bail).
  * 2e nombre => advance_months : le loyer d'avance (mois de loyer payés d'avance à l'entrée).
  * 3e nombre => commission_months : les frais d'agence / du commissionnaire.
- Deux nombres seulement ("4+1", "3 + 1") => garantie + avance : deposit_months = 1er nombre, advance_months = 2e nombre, commission_months null.
- Un seul nombre ("Garantie : 3 mois", "caution 2 mois") => deposit_months uniquement ; advance_months et commission_months restent null.
- Si le message nomme explicitement chaque poste ("2 mois de garantie, 1 mois d'avance, 1 mois de commission"), suis les libellés écrits plutôt que l'ordre des nombres.
- Ne mets jamais un total dans deposit_months : chaque champ ne contient que son propre poste.

LOCALISATION
- Les 24 communes de Kinshasa, chacune avec ses quartiers officiels :
${LOCATIONS_BLOCK}
- Normalise la commune vers l'une de ces orthographes exactes ("gombé" => "Gombe", "Bandal" => "Bandalungwa", "Djili" => "Ndjili").
- Normalise le quartier vers l'orthographe exacte listée pour SA commune ci-dessus ("Ma Campagne" => "Macampagne", "la gombe" => reste dans commune, pas quartier). Si le quartier mentionné n'apparaît dans aucune liste (nouveau lotissement, référence informelle type "Righini", "Pompage"), rapporte-le tel quel plutôt que d'inventer une correspondance.
- La référence précise va dans "quartier", jamais dans "commune".

IMAGES
- Des photos peuvent accompagner le message (photos du bien, flyer, pancarte, capture d'écran).
- Lis TOUT texte visible sur les images (prix, superficie, numéro de téléphone, nom d'agence, mention "à louer"/"à vendre") et sers-t'en pour compléter ou corriger le texte du message.
- Si le texte du message et l'image se contredisent, privilégie le texte écrit par l'agent et signale la contradiction dans summary_fr.
- Tu peux déduire les équipements clairement visibles (piscine, jardin, carrelage, étage, clôture, panneaux solaires).
- Ne devine JAMAIS un prix, une superficie, une commune ou une adresse à partir d'une photo seule : s'ils ne sont pas écrits, laisse null.
- Une photo seule sans aucune indication de bien immobilier => is_listing false.

CLASSIFICATION DU TYPE DE BIEN — RÈGLES SPÉCIFIQUES À KINSHASA

1. PARCELLE (terrain / propriété clôturée, bâtie ou non)
   - Si l'annonce mentionne des dimensions de terrain ("5,30m sur 18m", "15/20m"), une propriété clôturée ("clôturé", "portail"), ou "Maison Type Locataire" / un nombre de "Portes", classe property_type comme "parcelle".
   - NE classe JAMAIS une annonce comme "appartement" uniquement parce qu'une superficie (m²) ou plusieurs pièces/portes sont mentionnées — ce sont des signaux de parcelle, pas d'appartement.
   - Sous-types autorisés (champ parcelle_subtype, rempli UNIQUEMENT si property_type = "parcelle", sinon null) : "maison_type_locataire" (maison à portes multiples, locative), "villa", "terrain_nu" (terrain non bâti). Laisse null si le message ne permet pas de trancher.

2. APPARTEMENT
   - Classe property_type comme "appartement" UNIQUEMENT si le message décrit explicitement un logement individuel dans un immeuble à étages ou une résidence collective (ex. "Appartement au 2ème étage", "Immeuble").

3. DIMENSIONS ET UNITÉS
   - "X Portes" / "Type Locataire" : mets X dans units_count. Cela signale une parcelle locative à revenus (plusieurs logements loués séparément), pas un appartement unique.
   - Une référence explicite dans le texte brut ("Réf:", "Référence:" suivi d'un code ou numéro) va dans le champ "reference" — un identifiant de l'annonce elle-même, à ne JAMAIS confondre avec le quartier ou toute autre référence de localisation (qui vont dans "quartier", voir LOCALISATION ci-dessus).

RÈGLES D'EXTRACTION
1. N'invente rien. Tout champ absent du message doit être null (ou [] pour les listes). Une annonce partielle est normale.
2. Ne convertis pas les devises. Rapporte le montant et la devise tels qu'ils apparaissent.
3. Convertis les dimensions en superficie : "20x30" => 600 m², "5,30m sur 18m" => 95,4 m², "15/20m" => 300 m² (la virgule est un séparateur décimal, pas de milliers).
4. is_listing = false pour les salutations, questions, demandes de client ("je cherche un studio") ou bavardages. Remplis alors intent et laisse les champs de l'annonce à null.
5. missing_fields : uniquement les champs essentiels manquants, parmi ${MISSING_FIELD_KEYS.join(', ')}.
6. confidence : 0.9+ pour une annonce claire, ~0.5 pour un message vague, <0.3 si ce n'est probablement pas une annonce.
7. summary_fr : une phrase de résumé en français.

TOLÉRANCE AU CHAOS (messages WhatsApp réels)
- Les agents écrivent vite : fautes de frappe, dictée vocale mal transcrite, ponctuation absente, majuscules aléatoires, français et lingala mélangés. Corrige mentalement et extrais quand même — ne rejette JAMAIS un message parce qu'il est mal écrit.
- Exemples de corrections attendues : "Slaongo" => "Salongo", "Ngaliem" => "Ngaliema", "3ch" / "3 ch" => bedrooms 3, "2sb" => bathrooms 2, "1200$" => price 1200 en USD, "loc" => location, "vte" => vente.
- Un nom propre déformé ou inhabituel ("Kkimmo") est un nom d'agent ou d'agence, pas une erreur à ignorer.
- Si un BROUILLON EN COURS t'est fourni, ne traite JAMAIS le message comme du bruit : il porte sur ce brouillon.

BROUILLON EN COURS — BOUCLE DE CORRECTION
Ces règles ne s'appliquent QUE si un bloc "BROUILLON EN COURS" accompagne le message. Sinon, ignore cette section.
- Le message est presque toujours une modification du brouillon (prix, chambres, commune, garantie, référence...), une confirmation, ou une question à son sujet.
- Mets is_listing à false, SAUF si le message décrit clairement un bien DIFFÉRENT et supplémentaire (une seconde annonce). Une reformulation, un ajout ou une correction du même bien => is_listing false.
- Dans extracted_data, renvoie le brouillon COMPLET après fusion : reprends chaque valeur du brouillon et ne remplace que ce que le message corrige. Ne renvoie pas uniquement le champ modifié.
- Recalcule tout ce qui dépend d'une valeur modifiée : si le loyer change, les montants en dollars des conditions d'entrée changent aussi.
- Dans whatsapp_reply, réaffiche la fiche récapitulative COMPLÈTE (même gabarit que ci-dessous) avec les valeurs fusionnées, puis invite l'agent à répondre "OK" pour publier ou à envoyer une autre correction. Autant d'allers-retours que nécessaire.
- Ne demande JAMAIS à l'agent de renvoyer son annonce quand un brouillon existe : tu l'as déjà.
- Le bloc de contexte peut décrire une annonce DÉJÀ PUBLIÉE (champ statut = "publiée") et non un brouillon. Les mêmes règles s'appliquent : le message est presque toujours une modification de cette annonce. Mets alors is_correction à true. Ne parle pas de « publier » ni de répondre "OK" — elle est déjà en ligne : confirme simplement la mise à jour et réaffiche la fiche.
- is_correction = true dès que le message modifie l'annonce en contexte (brouillon ou publiée). false s'il décrit un bien différent, pose une question, ou s'il n'y a aucun contexte.

DISPONIBILITÉ — "c'est loué" / "c'est vendu"
- Si le message annonce que le bien en contexte n'est plus disponible ("c'est loué", "eza loué déjà", "vendu", "le bien est parti", "plus disponible"), renseigne listing_status_update : 'loue' pour une location conclue, 'vendu' pour une vente conclue, 'disponible' si l'agent revient en arrière.
- Dans ce cas is_listing = false et is_correction = false : ce n'est pas une modification de la fiche, c'est un changement de disponibilité.
- N'invente jamais ce champ à partir d'un simple mot comme "location" ou "à vendre" dans une annonce ordinaire : il ne s'agit que d'une transaction CONCLUE sur un bien déjà en ligne.
- PHOTO OBLIGATOIRE : si le brouillon indique photos_count = 0 et que l'agent essaie de confirmer ("OK", "publiez", "c'est bon"), positionne is_confirmed à false et indique dans whatsapp_reply qu'il manque une photo — l'annonce ne peut pas être publiée sans au moins une photo du bien. Reste chaleureux : le bien est bien enregistré, il ne manque que la photo.

CONFIRMATION (champ is_confirmed)
- is_confirmed = true UNIQUEMENT si un BROUILLON EN COURS est fourni ET que le message exprime un accord pour publier SANS apporter la moindre information nouvelle ou modifiée ("c'est bon, publiez", "parfait merci", "oui vous pouvez publier", "rien à changer").
- is_confirmed = false dès que le message contient une correction, même précédée d'un accord : "ok mais 4 chambres" => false.
- Sans brouillon en cours, is_confirmed est toujours false.

IDENTITÉ ET AGENCE
- Un agent peut corriger son identité en cours de route : "ce n'est pas mon compte", "je m'appelle Kkimmo", "mon agence c'est Kkimmo Immo".
- Mets le nom de la personne dans agent_name et le nom de l'agence dans agency_name. Laisse-les null si le message n'en parle pas.
- Une correction d'identité n'annule JAMAIS le brouillon : accuse réception du changement, réaffiche la fiche complète du bien, et demande si l'agent souhaite publier.

IMMEUBLE À PLUSIEURS LOGEMENTS (multi-unités)
- Un même message décrit souvent PLUSIEURS logements distincts dans un seul immeuble : "3 chambres 1500$, 3 chambres 900$, 2 chambres 700$, 2 chambres 600$". Ce n'est PAS une annonce unique : ne choisis jamais un seul prix ou un seul nombre de chambres en ignorant les autres.
- Indices : plusieurs prix dans le même message, plusieurs nombres de chambres, une énumération (tirets, numéros, retours à la ligne), "appartement A / B", "au 1er étage ... au 2ème étage", "nous avons aussi".
- Dans ce cas : is_multi_unit = true, et units contient UNE entrée par typologie distincte, chacune avec son propre prix, ses chambres, ses salles de bain, son étage et ses équipements.
- building_name : le nom de l'immeuble ou de la résidence s'il est donné. La commune, le quartier, la référence et le type de transaction restent au niveau du message : ils sont communs à tout l'immeuble, ne les répète pas dans chaque unité.
- "3 unités disponibles" pour une même typologie => quantity = 3 sur CETTE entrée, et non trois entrées identiques.
- Les champs de premier niveau (price, bedrooms, bathrooms...) décrivent alors le logement le MOINS cher, pour que l'annonce reste lisible si les unités ne sont pas exploitées. Le détail fait foi.
- Une annonce à logement unique garde is_multi_unit = false, is_multi_property = false et units = [].

PLUSIEURS BIENS DISTINCTS DANS UN SEUL MESSAGE
- Un agent envoie parfois plusieurs biens SANS LIEN entre eux d'un coup : "Villa à louer Gombe 1500$ / Appartement Limete 600$". Ce n'est PAS un immeuble : les biens sont à des adresses différentes.
- Dans ce cas : is_multi_property = true, is_multi_unit = false, et units contient une entrée par bien, chacune avec SA propre commune, son quartier, son type de bien et son type de transaction en plus du prix et des chambres.
- Comment trancher : mêmes commune/quartier/immeuble et seules les typologies changent => is_multi_unit. Communes ou types de biens différents => is_multi_property. Les deux ne sont jamais vrais en même temps.
- Récapitulatif : liste numérotée, une ligne par bien avec sa commune et son prix, puis : Répondez "OK" pour publier ces {N} annonces. "4 Portes" / "Type Locataire" n'est PAS un immeuble multi-unités : c'est une parcelle locative, units_count (voir plus haut).

RÈGLES POUR whatsapp_reply
- Écris en français simple et respectueux, ton professionnel et chaleureux, tutoiement exclu (vouvoiement).
- LANGUE : réponds dans la langue principale du message de l'agent. Un message majoritairement en lingala reçoit une réponse en lingala (les libellés de la fiche — Commune, Loyer, Chambres — restent en français, ce sont les termes du métier à Kinshasa) ; un message en anglais reçoit une réponse en anglais. Dans le doute, ou pour un message mélangé, réponds en français.
- Si is_listing est true, suis EXACTEMENT ce gabarit (une ligne par champ non-null ; omets toute ligne dont la valeur serait null) :

Bonjour! Merci pour votre message. Voici les informations extraites de la magnifique résidence que vous avez à louer / vendre :

*Type de transaction* : {transaction_type}
*Catégorie de propriété* : {property_type}
*Sous-type* : {parcelle_subtype}
*Commune* : {commune}
*Quartier* : {quartier}
*Loyer* ou *Prix* : {price}$ {price_period}
*Garantie* : {deposit_months} mois
*Loyer d'avance* : {advance_months} mois
*Commission d'agence* : {commission_months} mois
*Total à prévoir à l'entrée* : {deposit_months + advance_months + commission_months} mois
*Chambres* : {bedrooms}
*Salles de bain* : {bathrooms}
*Nombre de portes* : {units_count}
*Équipements* : {amenities}
*Référence* : {reference}

- Conditions d'entrée : n'écris que les lignes dont la valeur est non-null, et n'ajoute la ligne *Total à prévoir à l'entrée* que si au moins deux des trois postes sont connus. Si price est connu et price_period vaut "mois", ajoute le montant entre parenthèses après CHACUNE de ces quatre lignes, ligne de total comprise, calculé comme (nombre de mois × loyer mensuel) — ex. avec un loyer de 750 $ et "3 + 1 + 1" : "*Garantie* : 3 mois (2250 $)" ... "*Total à prévoir à l'entrée* : 5 mois (3750 $)". Sans loyer mensuel connu, écris seulement les mois.

  Puis, s'il y a des missing_fields, demande-les explicitement. Termine en invitant l'agent à répondre "OK" pour publier ou à envoyer une correction.
- Si is_multi_unit est true, n'utilise PAS le gabarit ci-dessus. Écris à la place un récapitulatif groupé : le nom de l'immeuble (ou la commune/quartier à défaut) sur la première ligne, puis "🏢 {N} typologies d'appartements détectées :", puis UNE ligne numérotée par typologie — "1️⃣ 3 Chambres / 3 Salles de bain — 1500$", en ajoutant entre parenthèses ce qui distingue l'unité quand c'est connu (étage, parking, "3 unités disponibles"). Termine par : Répondez "OK" pour publier ces {N} annonces liées.
- Si is_listing est false ET qu'un BROUILLON EN COURS est fourni : ne redemande rien — confirme la correction en une phrase, réaffiche la fiche complète ci-dessus avec les valeurs fusionnées, puis invite à répondre "OK" pour publier ou à envoyer une autre correction.
- Si is_listing est false et qu'aucun brouillon n'est en cours : réponds brièvement et demande à l'agent d'envoyer l'annonce avec le type de bien, la commune, le prix et le nombre de chambres.
- Utilise le formatage WhatsApp (*gras*, un seul astérisque de chaque côté — jamais **double**) avec parcimonie et au maximum 2 emojis. Reste sous 900 caractères.
- N'inclus JAMAIS de données que tu n'as pas réellement extraites du message.`;

/**
 * Structured Outputs schema.
 *
 * `strict: true` has two hard requirements that are easy to get wrong and that
 * cause a 400 from the API rather than a soft failure: every object must set
 * `additionalProperties: false`, and every property must be listed in
 * `required`. Optional fields are therefore expressed as nullable types
 * (`['string', 'null']`), never by omission from `required`.
 */
const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'lukka_listing_extraction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['extracted_data', 'whatsapp_reply'],
      properties: {
        extracted_data: {
          type: 'object',
          additionalProperties: false,
          required: [
            'is_listing', 'is_confirmed', 'intent', 'transaction_type', 'property_type',
            'parcelle_subtype',
            'commune', 'quartier', 'price', 'currency', 'price_period', 'deposit_months',
            'advance_months', 'commission_months',
            'bedrooms', 'bathrooms', 'surface_area_sqm', 'units_count', 'furnished',
            'amenities', 'reference', 'agent_name', 'agency_name', 'summary_fr',
            'missing_fields', 'confidence',
            'is_multi_unit', 'is_multi_property', 'building_name', 'units',
            'is_correction', 'listing_status_update',
          ],
          properties: {
            is_listing: {
              type: 'boolean',
              description: 'true si le message décrit un bien à louer ou à vendre.',
            },
            is_confirmed: {
              type: 'boolean',
              description:
                "true uniquement si un brouillon est en cours ET que le message approuve sa publication sans apporter la moindre correction. Toujours false sans brouillon.",
            },
            intent: {
              type: 'string',
              enum: ['listing', 'buyer_request', 'question', 'greeting', 'other'],
            },
            transaction_type: { type: ['string', 'null'], enum: ['location', 'vente', null] },
            property_type: { type: ['string', 'null'], enum: [...PROPERTY_TYPES, null] },
            parcelle_subtype: {
              type: ['string', 'null'],
              enum: [...PARCELLE_SUBTYPES, null],
              description: "Sous-type de la parcelle — rempli uniquement quand property_type = 'parcelle'.",
            },
            commune: {
              type: ['string', 'null'],
              description: 'Commune de Kinshasa, orthographe normalisée.',
            },
            quartier: { type: ['string', 'null'], description: 'Quartier ou référence précise, dans la liste de la commune si possible.' },
            price: {
              type: ['number', 'null'],
              description: 'Loyer mensuel si location, prix total si vente.',
            },
            currency: { type: ['string', 'null'], enum: ['USD', 'CDF', 'EUR', null] },
            price_period: { type: ['string', 'null'], enum: ['mois', 'an', 'total', null] },
            deposit_months: {
              type: ['integer', 'null'],
              description: "Mois de garantie locative SEULE (caution restituable). Dans la notation \"3 + 1 + 1\", c'est le premier nombre — jamais la somme.",
            },
            advance_months: {
              type: ['integer', 'null'],
              description: "Mois de loyer d'avance — deuxième nombre de la notation \"3 + 1 + 1\".",
            },
            commission_months: {
              type: ['integer', 'null'],
              description: "Mois de frais d'agence / commissionnaire — troisième nombre de la notation \"3 + 1 + 1\".",
            },
            bedrooms: {
              type: ['integer', 'null'],
              description: 'Nombre de chambres (pas le total des pièces).',
            },
            bathrooms: { type: ['integer', 'null'] },
            surface_area_sqm: { type: ['number', 'null'], description: 'Superficie en m².' },
            units_count: {
              type: ['integer', 'null'],
              description: 'Nombre de portes/logements ("X Portes", "Type Locataire") — parcelle locative à revenus.',
            },
            furnished: { type: ['boolean', 'null'] },
            amenities: {
              type: 'array',
              items: { type: 'string' },
              description: 'piscine, forage, groupe électrogène, climatisation, parking, jardin, sécurité...',
            },
            reference: {
              type: ['string', 'null'],
              description: "Code/numéro de référence explicite de l'annonce (\"Réf:\", \"Référence:\"), distinct du quartier.",
            },
            agent_name: {
              type: ['string', 'null'],
              description:
                "Nom de l'agent, uniquement quand le message le corrige ou l'annonce explicitement (\"je m'appelle Kkimmo\").",
            },
            agency_name: {
              type: ['string', 'null'],
              description:
                "Nom de l'agence, uniquement quand le message le corrige ou l'annonce explicitement.",
            },
            summary_fr: { type: 'string', description: 'Résumé en une phrase, en français.' },
            missing_fields: {
              type: 'array',
              items: { type: 'string', enum: MISSING_FIELD_KEYS },
            },
            confidence: { type: 'number', description: 'Confiance globale entre 0 et 1.' },
            is_correction: {
              type: 'boolean',
              description:
                "true si le message modifie une annonce déjà existante fournie en contexte (brouillon ou annonce déjà publiée) plutôt que d'en décrire une nouvelle. false sans contexte.",
            },
            listing_status_update: {
              type: ['string', 'null'],
              enum: ['loue', 'vendu', 'disponible', null],
              description:
                "Renseigné UNIQUEMENT si le message annonce un changement de disponibilité du bien en contexte : \"c'est loué\" => 'loue', \"c'est vendu\" => 'vendu', \"finalement c'est encore libre\" => 'disponible'. null sinon.",
            },
            is_multi_property: {
              type: 'boolean',
              description:
                "true si le message décrit plusieurs biens DISTINCTS et sans lien (communes ou types différents), et non plusieurs logements d'un même immeuble. Mutuellement exclusif avec is_multi_unit.",
            },
            is_multi_unit: {
              type: 'boolean',
              description:
                "true si le message décrit PLUSIEURS logements distincts dans un même immeuble/une même adresse (typologies différentes, prix différents). false pour une annonce ordinaire.",
            },
            building_name: {
              type: ['string', 'null'],
              description:
                "Nom de l'immeuble ou de la résidence quand il est donné (\"Résidence Kin Marché\"). null sinon.",
            },
            units: {
              type: 'array',
              description:
                "Une entrée par TYPOLOGIE distincte quand is_multi_unit est true. Vide ([]) sinon — ne duplique jamais ici une annonce à logement unique.",
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'bedrooms', 'bathrooms', 'price', 'price_period', 'surface_area_sqm',
                  'floor', 'furnished', 'amenities', 'quantity', 'summary_fr',
                  'transaction_type', 'property_type', 'commune', 'quartier',
                ],
                properties: {
                  bedrooms: { type: ['integer', 'null'] },
                  bathrooms: { type: ['integer', 'null'] },
                  price: { type: ['number', 'null'], description: 'Prix de CETTE typologie.' },
                  price_period: { type: ['string', 'null'], enum: ['mois', 'an', 'total', null] },
                  surface_area_sqm: { type: ['number', 'null'] },
                  floor: {
                    type: ['string', 'null'],
                    description: 'Étage tel qu\'écrit ("Rez-de-chaussée", "2ème étage", "étage élevé").',
                  },
                  furnished: { type: ['boolean', 'null'] },
                  amenities: { type: 'array', items: { type: 'string' } },
                  quantity: {
                    type: ['integer', 'null'],
                    description:
                      'Nombre de logements IDENTIQUES de cette typologie ("3 unités disponibles" => 3). null si non précisé.',
                  },
                  summary_fr: { type: 'string', description: 'Résumé court de cette typologie.' },
                  // Renseignés UNIQUEMENT pour is_multi_property (biens
                  // distincts). Pour un immeuble, ces informations sont
                  // communes et restent au niveau du message.
                  transaction_type: { type: ['string', 'null'], enum: ['location', 'vente', null] },
                  property_type: { type: ['string', 'null'], enum: [...PROPERTY_TYPES, null] },
                  commune: { type: ['string', 'null'] },
                  quartier: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
        whatsapp_reply: {
          type: 'string',
          description: "Message en français à renvoyer à l'agent sur WhatsApp.",
        },
      },
    },
  },
};

/**
 * Image formats the vision endpoint accepts. Worth validating up front: an
 * unsupported type (HEIC off an iPhone, a PDF flyer) is a 400 from the API,
 * which reads as an outage rather than a bad input unless we name it here.
 */
const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Cap on images per request. Each one costs tokens, and an agent dumping a
 * 30-photo album would otherwise turn one listing into a very expensive call.
 */
// Matches web/app/compte/agent/actions.js's MAX_LISTING_PHOTOS (10). The two
// channels must agree: at 8 here, an agent who could upload 10 photos on the
// web silently lost 2 of them by sending the same listing over WhatsApp.
const MAX_IMAGES = Number.parseInt(process.env.OPENAI_MAX_IMAGES, 10) || 10;

/**
 * 'high' re-reads the image in 512px tiles — better at small print on a flyer,
 * but more tokens. 'auto' lets the API decide from the image size.
 */
const IMAGE_DETAIL = process.env.OPENAI_IMAGE_DETAIL || 'auto';

/**
 * Turn one caller-supplied image into an `image_url` content part.
 *
 * Accepts, in order of preference:
 *   { data: '<base64>', mimeType: 'image/jpeg' }   <- what a media download gives
 *   { url: 'https://…' | 'data:image/…;base64,…' }
 *   '<data URI or https URL string>'
 *
 * @returns {{type: 'image_url', image_url: {url: string, detail: string}}}
 */
function toImagePart(image, detail) {
  if (!image) {
    throw new Error('parseMessage received an empty image entry');
  }

  // Bare string: already a data URI or a fetchable URL.
  if (typeof image === 'string') {
    const trimmed = image.trim();
    if (!/^(data:image\/|https?:\/\/)/i.test(trimmed)) {
      throw new Error('Image string must be a data:image/… URI or an http(s) URL');
    }
    return { type: 'image_url', image_url: { url: trimmed, detail } };
  }

  if (typeof image !== 'object') {
    throw new Error(`Unsupported image entry of type ${typeof image}`);
  }

  // Pre-built URL or data URI.
  if (image.url) {
    const url = String(image.url).trim();
    if (!/^(data:image\/|https?:\/\/)/i.test(url)) {
      throw new Error('image.url must be a data:image/… URI or an http(s) URL');
    }
    return { type: 'image_url', image_url: { url, detail: image.detail || detail } };
  }

  // Raw base64 + mime type.
  if (!image.data) {
    throw new Error('Image entry needs either { data, mimeType } or { url }');
  }

  const mimeType = String(image.mimeType || image.mime_type || '').toLowerCase().split(';')[0].trim();
  if (!mimeType) {
    throw new Error('Image entry with base64 data must also provide mimeType');
  }
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new Error(
      `Unsupported image type '${mimeType}'. Supported: ${SUPPORTED_IMAGE_MIME_TYPES.join(', ')}`,
    );
  }

  // Tolerate data that already carries the data-URI prefix; double-prefixing it
  // produces a URL the API rejects.
  const base64 = String(image.data).replace(/^data:[^,]*,/, '');

  return {
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${base64}`, detail: image.detail || detail },
  };
}

/** How many earlier turns of an in-progress submission are replayed to the model. */
const INTAKE_HISTORY_LIMIT = 5;

/** Draft fields worth showing the model. Deliberately excludes ids, wamids,
 *  status and photo paths — none of them help it merge a correction. */
const DRAFT_CONTEXT_FIELDS = [
  'transaction_type', 'property_type', 'parcelle_subtype', 'commune', 'quartier',
  'price', 'currency', 'price_period', 'deposit_months', 'advance_months',
  'commission_months', 'bedrooms', 'bathrooms', 'surface_area_sqm', 'units_count',
  'furnished', 'amenities', 'reference', 'agent_name', 'summary_fr',
];

/**
 * Turn a pending listing row into the `{ draft, history }` context parseMessage
 * takes, so a follow-up message is understood as an edit of that listing rather
 * than as a brand-new one.
 *
 * No new storage is involved: the pending row already *is* the memory. Its
 * `raw_text` accumulates one line per turn (services/db.js
 * applyListingCorrection appends to it), and its columns hold the merged draft.
 *
 * One honest limitation: the intake path never stores its own outbound replies,
 * so `history` is inbound-only — the agent's turns, not ours. The draft object
 * carries the same state our last summary card showed, in a cleaner form.
 *
 * @param {Object} row  A listing row as returned by services/db.js (parsed).
 * @returns {{draft?: Object, history?: Array<{role: string, content: string}>}}
 */
function draftContextFromListing(row) {
  if (!row) return {};

  const draft = {};
  for (const field of DRAFT_CONTEXT_FIELDS) {
    const value = row[field];
    if (value === undefined || value === null || value === '') continue;
    // SQLite has no boolean — 0/1 would read as a quantity to the model.
    draft[field] = field === 'furnished' ? Boolean(value) : value;
  }

  // agency_name has no column of its own; it only ever lives in the stored
  // extraction blob, so that is where a previously corrected one comes from.
  const agencyName = row.parsed_json?.agency_name;
  if (agencyName) draft.agency_name = agencyName;

  // The model cannot refuse a confirmation for a missing photo unless it knows
  // whether one exists. Always present (including 0) — an absent key would read
  // as "unknown" rather than "none", which is the case that must be refused.
  draft.photos_count = Array.isArray(row.photos) ? row.photos.length : 0;

  // A published listing is corrected, never "published" again — the model has
  // to know which it is or it will keep asking an agent to reply OK to a
  // listing that has been live for a week.
  draft.statut = row.status === 'published' ? 'publiée' : 'brouillon';

  const history = String(row.raw_text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-INTAKE_HISTORY_LIMIT)
    .map((content) => ({ role: 'user', content }));

  return { draft, history };
}

/**
 * Extract a listing from one WhatsApp message: text, images, or both.
 *
 * @param {string} [text]              Raw message body / image caption.
 * @param {Object} [options]
 * @param {Array<{data?: string, mimeType?: string, url?: string}|string>} [options.images]
 *        Inline images. `{ data, mimeType }` is the shape a WhatsApp media
 *        download returns.
 * @param {string} [options.senderPhone] Sender's number, passed as context only.
 * @param {string} [options.imageDetail] 'auto' | 'low' | 'high' for this call.
 * @param {Object} [options.draft]     Listing already pending this sender's 'OK'
 *        (see draftContextFromListing). Its presence is what switches the model
 *        into correction mode; omit it and the request is byte-identical to a
 *        first-contact call.
 * @param {Array<{role: string, content: string}>} [options.history]
 *        Earlier turns of the same submission, oldest first. Ignored without a draft.
 * @returns {Promise<{extracted_data: Object, whatsapp_reply: string, _meta: Object}>}
 */
async function parseMessage(text, { senderPhone, images = [], imageDetail, draft = null, history = [] } = {}) {
  const hasText = Boolean(text && String(text).trim());
  const suppliedImages = Array.isArray(images) ? images.filter(Boolean) : [];

  if (!hasText && suppliedImages.length === 0) {
    throw new Error('parseMessage requires text, images, or both');
  }

  // Never drop images silently — the caller and the logs both see the count.
  const usedImages = suppliedImages.slice(0, MAX_IMAGES);
  const droppedImages = suppliedImages.length - usedImages.length;
  if (droppedImages > 0) {
    console.warn(
      `[openai] ${suppliedImages.length} images supplied, using the first ${MAX_IMAGES} ` +
        `(${droppedImages} ignored — raise OPENAI_MAX_IMAGES to change this)`,
    );
  }

  const detail = imageDetail || IMAGE_DETAIL;

  const promptText = [
    senderPhone ? `Expéditeur : ${senderPhone}` : null,
    usedImages.length
      ? `Le message contient ${usedImages.length} image(s) ci-joint(es) — lis tout texte visible.`
      : null,
    '--- MESSAGE ---',
    hasText ? String(text).trim() : '(aucun texte, images uniquement)',
    '--- FIN DU MESSAGE ---',
  ]
    .filter(Boolean)
    .join('\n');

  // Content parts rather than a bare string, uniformly — the vision endpoint
  // accepts a text-only parts array, so there is no second code path.
  const userContent = [
    { type: 'text', text: promptText },
    ...usedImages.map((image) => toImagePart(image, detail)),
  ];

  // Without a pending draft this stays exactly [system, user] — a first-contact
  // extraction must not pay for, or be influenced by, an empty context block.
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (draft) {
    messages.push({
      role: 'system',
      content:
        'BROUILLON EN COURS — annonce déjà enregistrée pour cet agent, en attente de son "OK" :\n' +
        `${JSON.stringify(draft)}\n` +
        'Le message ci-dessous porte sur ce brouillon : applique la section ' +
        'BROUILLON EN COURS — BOUCLE DE CORRECTION.',
    });

    for (const turn of Array.isArray(history) ? history.slice(-INTAKE_HISTORY_LIMIT) : []) {
      const role = turn?.role === 'assistant' ? 'assistant' : 'user';
      const content = turn?.content ? String(turn.content).trim() : '';
      if (content) messages.push({ role, content });
    }
  }

  messages.push({ role: 'user', content: userContent });

  const completion = await getClient().chat.completions.create({
    model: MODEL,
    // Extraction, not creative writing — keep it deterministic.
    temperature: 0,
    response_format: RESPONSE_FORMAT,
    messages,
  });

  const choice = completion.choices?.[0];

  // With strict Structured Outputs a schema-valid object is guaranteed *if* the
  // model finished. It can still refuse, or stop early on max_tokens — in both
  // cases `content` is unusable and must not be parsed blindly.
  if (choice?.message?.refusal) {
    throw new Error(`Model refused the request: ${choice.message.refusal}`);
  }
  if (choice?.finish_reason === 'length') {
    throw new Error('Model output was truncated (finish_reason: length)');
  }

  const raw = choice?.message?.content;
  if (!raw) {
    throw new Error(`Model returned no content (finish_reason: ${choice?.finish_reason || 'unknown'})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Model returned non-JSON output: ${String(raw).slice(0, 200)}`);
  }

  return {
    extracted_data: parsed.extracted_data,
    whatsapp_reply: parsed.whatsapp_reply,
    _meta: {
      model: completion.model || MODEL,
      usage: completion.usage || null,
      finish_reason: choice.finish_reason,
      imageCount: usedImages.length,
      imagesDropped: droppedImages,
      imageDetail: usedImages.length ? detail : null,
    },
  };
}

// =============================================================================
// Buyer assistant — WhatsApp-first conversational property search
//
// Entirely separate pipeline from parseMessage() above (which extracts an
// AGENT's listing submission). This one drives the CUSTOMER-facing search
// conversation: understands a natural-language request, calls real tools to
// search/inspect Lukka Place's live property data, and drafts a reply — never
// inventing a price, address, or availability it didn't get from a tool
// result (product spec §12/§43). Nothing above this line is touched; nothing
// below it is wired into routes/webhook.js yet — see CLAUDE.md's "WhatsApp
// Property-Search Assistant" section for what's built vs. still to come.
// =============================================================================

const propertyMatchingService = require('./propertyMatching');
const propertyRepositoryService = require('./propertyRepository');
const dbService = require('./db');
const { dispatchLeadInBackground } = require('./leadDispatch');
// Second require of an already-cached module (services/openai.js's top-level
// require above only pulls LOCATIONS/COMMUNES) — cheap and deliberately kept
// separate so the original import line is never touched.
const { quartiersForCommune } = require('./locations');

const BUYER_SYSTEM_PROMPT = `Tu es l'assistant de recherche immobilière de Lukka Place, une plateforme proptech à Kinshasa (République Démocratique du Congo), sur WhatsApp.

Ton rôle : aider un client à trouver un bien à louer ou à acheter à Kinshasa, en conversant naturellement en français (le kinois mélange souvent français/anglais/lingala — comprends ces messages sans les corriger).

RÈGLES ESSENTIELLES
1. Ne réponds JAMAIS avec un prix, une adresse, une disponibilité ou une caractéristique que tu n'as pas obtenue via un outil. Si tu ne sais pas, dis-le ou propose de vérifier.
2. Utilise l'outil search_properties dès que tu as au moins un critère exploitable (commune, budget, type de transaction ou type de bien) — n'attends pas d'avoir toutes les informations.
3. Ne pose qu'UNE seule question de suivi à la fois, jamais une liste de questions. Ne redemande jamais une information déjà connue (voir "Exigences déjà connues" fourni dans la conversation).
4. Si search_properties renvoie widened=true, dis clairement que rien n'a été trouvé dans la commune demandée et que ce sont des résultats élargis — ne présente jamais un résultat élargi comme une correspondance exacte.
5. Si le client demande explicitement à parler à quelqu'un ("agent", "humain", "je veux parler à quelqu'un"), ou souhaite planifier une visite ou négocier, utilise handoff_to_agent immédiatement.
6. Utilise create_enquiry dès qu'une demande devient sérieuse (le client veut être recontacté, veut plus d'informations sur un bien précis).
7. Utilise request_viewing quand le client demande explicitement une visite.
8. Ton professionnel, chaleureux, vouvoiement. Formatage WhatsApp (*gras*) avec parcimonie, maximum 2 emojis, reste sous 900 caractères.
9. N'invente jamais un numéro de téléphone d'agent ou un lien direct — Lukka Place fonctionne via ce numéro WhatsApp central uniquement.`;

const BUYER_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_properties',
      description:
        "Recherche des biens réels et approuvés sur Lukka Place selon les critères du client. À utiliser dès qu'au moins un critère exploitable est connu — ne pas attendre d'avoir tout.",
      parameters: {
        type: 'object',
        properties: {
          transaction_type: { type: 'string', enum: ['location', 'vente'] },
          property_type: { type: 'string', enum: ['appartement', 'parcelle'] },
          commune: { type: 'string', description: 'Une des 24 communes de Kinshasa.' },
          quartier: { type: 'string' },
          price_min: { type: 'number' },
          price_max: { type: 'number' },
          bedrooms: { type: 'integer', description: 'Nombre minimum de chambres.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_property',
      description: "Récupère les détails réels et complets d'un bien précis par son identifiant Lukka Place.",
      parameters: {
        type: 'object',
        properties: { property_id: { type: 'integer' } },
        required: ['property_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_location',
      description: "Liste les 24 communes de Kinshasa, ou les quartiers réels d'une commune donnée.",
      parameters: {
        type: 'object',
        properties: { commune: { type: 'string', description: 'Optionnel — pour lister les quartiers de cette commune.' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_enquiry',
      description: "Enregistre une demande sérieuse du client comme prospect (lead) pour l'équipe Lukka Place.",
      parameters: {
        type: 'object',
        properties: {
          property_id: { type: 'integer', description: 'Bien concerné, si connu.' },
          summary: { type: 'string', description: 'Résumé en une phrase de la demande du client.' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_viewing',
      description: 'Enregistre une demande de visite pour un bien.',
      parameters: {
        type: 'object',
        properties: {
          property_id: { type: 'integer' },
          requested_time: { type: 'string', description: 'Moment souhaité tel que formulé par le client (ex: "demain matin").' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'handoff_to_agent',
      description:
        "Transfère la conversation à un agent humain — dès que le client le demande explicitement, ou souhaite planifier une visite / négocier.",
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string', description: 'Raison courte du transfert, en français.' } },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  },
];

/** Real search — never random/unranked records (product spec §10). Errors degrade to a flagged empty result, never a throw into the model loop. */
async function executeSearchProperties(args = {}) {
  const result = await propertyMatchingService.matchProperties({
    transactionType: args.transaction_type,
    propertyType: args.property_type,
    commune: args.commune,
    quartier: args.quartier,
    priceMin: args.price_min,
    priceMax: args.price_max,
    bedsMin: args.bedrooms,
    limit: 5,
  });

  if (result.error) {
    return { error: 'search_unavailable' };
  }

  return {
    total: result.total,
    widened: result.widened,
    properties: result.data.map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      currency: 'USD',
      transaction: p.purpose === 'rent' ? 'location' : 'vente',
      commune: p.commune || null,
      quartier: p.quartier || null,
      bedrooms: p.beds,
      bathrooms: p.bath,
      area_sqm: p.area,
      category: p.category_name,
      reference: p.reference,
    })),
  };
}

/** Real lookup by id — `found: false` (never a fabricated fallback) when the property doesn't exist, isn't approved, or the DB is unreachable. */
async function executeGetProperty(args = {}) {
  const property = await propertyRepositoryService.getPropertyById(args.property_id);
  if (!property) {
    return { found: false };
  }
  return {
    found: true,
    id: property.id,
    title: property.title,
    price: property.price,
    currency: 'USD',
    transaction: property.purpose === 'rent' ? 'location' : 'vente',
    commune: property.commune || null,
    quartier: property.quartier || null,
    address: property.address,
    bedrooms: property.beds,
    bathrooms: property.bath,
    area_sqm: property.area,
    category: property.category_name,
    reference: property.reference,
    description: property.description || null,
  };
}

/** Real commune/quartier data (kinshasa_locations.json via services/locations.js) — never an invented list. */
function executeGetLocation(args = {}) {
  if (args.commune) {
    return { commune: args.commune, quartiers: quartiersForCommune(args.commune) };
  }
  return { communes: KINSHASA_COMMUNES };
}

/**
 * `context` binds identity/requirements from the OUTER conversation, never
 * from the model's own tool arguments — the model proposes an action, it
 * never gets to assert whose lead this is or what they already told us.
 */
function leadDefaultsFromContext(context) {
  return {
    conversation_id: context.conversationId,
    wa_id: context.waId,
    source: 'whatsapp',
    transaction_type: context.requirements?.transaction_type,
    commune: context.requirements?.commune,
    quartier: context.requirements?.quartier,
    price_min: context.requirements?.price_min,
    price_max: context.requirements?.price_max,
    bedrooms: context.requirements?.bedrooms,
  };
}

function executeCreateEnquiry(args = {}, context) {
  const lead = dbService.createLead({
    ...leadDefaultsFromContext(context),
    property_id: args.property_id ?? context.selectedPropertyId ?? null,
    requirements_summary: args.summary || null,
  });

  // AUTOMATED AGENT MATCHING — the WhatsApp-side event trigger, the twin of
  // the one in routes/admin.js's POST /leads. A customer who describes what
  // they want to the WhatsApp assistant must reach the same seven agencies
  // as one who fills in the web form; matching only the web path would leave
  // the platform's primary intake channel unmatched.
  //
  // Fire-and-forget by construction: this executor runs inside runBuyerTurn's
  // tool loop, which the customer is waiting on for a reply. Ranking seven
  // agencies and sending seven WhatsApp messages inline would add seconds to
  // every enquiry confirmation.
  dispatchLeadInBackground(lead);

  return { created: true, lead_id: lead.id, status: lead.status };
}

function executeRequestViewing(args = {}, context) {
  const lead =
    dbService.getLeadByConversationId(context.conversationId) ||
    dbService.createLead({
      ...leadDefaultsFromContext(context),
      property_id: args.property_id ?? context.selectedPropertyId ?? null,
    });

  const viewing = dbService.createViewingRequest({
    leadId: lead.id,
    propertyId: args.property_id ?? context.selectedPropertyId ?? null,
    requestedTime: args.requested_time || null,
  });
  dbService.updateLeadStatus(lead.id, 'VIEWING_REQUESTED');

  return { created: true, viewing_request_id: viewing.id, lead_id: lead.id, status: viewing.status };
}

function executeHandoffToAgent(args = {}, context) {
  const lead =
    dbService.getLeadByConversationId(context.conversationId) ||
    dbService.createLead({
      ...leadDefaultsFromContext(context),
      requirements_summary: args.reason ? `Transfert : ${args.reason}` : null,
    });

  dbService.setConversationAiActive(context.conversationId, false);

  // A conversation already in HUMAN_HANDOFF (or otherwise terminal) simply
  // can't make this transition again — ai_active above is what actually
  // matters here, so a rejected transition is logged, not fatal.
  let stateChanged = false;
  try {
    dbService.updateConversationState(context.conversationId, 'HUMAN_HANDOFF');
    stateChanged = true;
  } catch (err) {
    console.warn(`[openai] handoff_to_agent: state transition skipped for conversation #${context.conversationId} (${err.message})`);
  }

  return { handed_off: true, lead_id: lead.id, state_changed: stateChanged };
}

const BUYER_TOOL_EXECUTORS = {
  search_properties: (args) => executeSearchProperties(args),
  get_property: (args) => executeGetProperty(args),
  get_location: (args) => executeGetLocation(args),
  create_enquiry: (args, context) => executeCreateEnquiry(args, context),
  request_viewing: (args, context) => executeRequestViewing(args, context),
  handoff_to_agent: (args, context) => executeHandoffToAgent(args, context),
};

/** Dispatch one model-requested tool call to its real executor. Never throws into the orchestration loop — an unknown tool or bad JSON becomes a `{ error }` result the model can react to. */
async function executeBuyerTool(call, context) {
  const name = call?.function?.name;
  const executor = BUYER_TOOL_EXECUTORS[name];
  if (!executor) {
    return { error: `unknown_tool:${name}` };
  }

  let args;
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { error: 'invalid_arguments' };
  }

  try {
    return await executor(args, context);
  } catch (err) {
    console.error(`[openai] buyer tool '${name}' failed: ${err.message}`);
    return { error: 'tool_execution_failed' };
  }
}

/** A stuck tool-call loop (model never settles on a final text reply) degrades to this rather than sending nothing (product spec §53). */
const BUYER_ASSISTANT_FALLBACK_REPLY =
  'Je rencontre actuellement un problème pour effectuer la recherche. Veuillez réessayer dans quelques instants.';

const BUYER_MAX_TOOL_ITERATIONS = 4;
const BUYER_HISTORY_LIMIT = 20;

/**
 * Run one turn of the buyer-search conversation: send the customer's message
 * (plus known requirements + recent history) to the model with tools
 * enabled, execute whatever real tool calls it makes, and loop until it
 * produces a final text reply or hits the iteration cap.
 *
 * Not wired into routes/webhook.js yet — see CLAUDE.md. A future caller is
 * responsible for: loading `requirements`/`history` from services/db.js,
 * calling this, then persisting the reply via recordMessage() and sending it
 * through services/chakra.js, exactly like the listing pipeline already does.
 *
 * @param {Object} options
 * @param {number} options.conversationId
 * @param {string} options.waId
 * @param {Object} [options.requirements] Known fields from the `conversations` row (commune, price_min, bedrooms, ...).
 * @param {Array<{direction: 'inbound'|'outbound', text: string}>} [options.history] Prior messages, oldest first.
 * @param {string} options.userMessage
 * @param {number} [options.selectedPropertyId]
 * @returns {Promise<{reply: string, toolCalls: Array, iterations: number}>}
 */
async function runBuyerTurn({
  conversationId, waId, requirements = {}, history = [], userMessage, selectedPropertyId,
} = {}) {
  if (!conversationId) throw new Error('runBuyerTurn requires conversationId');
  if (!waId) throw new Error('runBuyerTurn requires waId');
  if (!userMessage || !String(userMessage).trim()) throw new Error('runBuyerTurn requires userMessage');

  const context = { conversationId, waId, requirements, selectedPropertyId };

  const messages = [
    { role: 'system', content: BUYER_SYSTEM_PROMPT },
    { role: 'system', content: `Exigences déjà connues pour ce client (ne pas redemander) : ${JSON.stringify(requirements)}` },
    ...history.slice(-BUYER_HISTORY_LIMIT).map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.text || '',
    })),
    { role: 'user', content: String(userMessage) },
  ];

  const toolCalls = [];
  let reply = null;
  let iterations = 0;

  while (iterations < BUYER_MAX_TOOL_ITERATIONS) {
    iterations += 1;

    const completion = await getClient().chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      tools: BUYER_TOOLS,
      messages,
    });

    const choice = completion.choices?.[0];
    if (choice?.message?.refusal) {
      throw new Error(`Buyer assistant refused: ${choice.message.refusal}`);
    }

    const requestedCalls = choice?.message?.tool_calls || [];

    if (requestedCalls.length === 0) {
      reply = choice?.message?.content || '';
      break;
    }

    messages.push(choice.message);

    for (const call of requestedCalls) {
      const result = await executeBuyerTool(call, context);
      toolCalls.push({ name: call.function?.name, arguments: call.function?.arguments, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return {
    reply: reply === null ? BUYER_ASSISTANT_FALLBACK_REPLY : reply,
    toolCalls,
    iterations,
  };
}

// =============================================================================
// Smart Paste — agent-dashboard "Auto-Fill from WhatsApp Text" (web/)
//
// A THIRD, separate pipeline from parseMessage() (WhatsApp intake) and the
// buyer assistant above. An agent already signed into the web dashboard
// pastes the same kind of raw text they'd otherwise send over WhatsApp, and
// this returns structured fields to fill the create/edit form plus a clean
// prose description for the public listing page — never invented text: every
// field mirrors the extraction rules and deposit/advance/commission split
// parseMessage() already uses, so the two pipelines cannot disagree about
// what "3 + 1 + 1" means. No whatsapp_reply, no is_listing/intent
// classification (dashboard input is always assumed to be a listing) — those
// are WhatsApp-specific concerns this pipeline doesn't have.
//
// Deliberately excludes any phone/contact field: root CLAUDE.md is explicit
// that every "Contact" CTA routes through Lukka Place's one central WhatsApp
// number and no per-listing agent phone is synced to Supabase — the agent's
// own identity already comes from their signed-in dashboard session, and a
// name/number lifted from pasted text has no real field to land in.
// =============================================================================

const LISTING_FORM_SYSTEM_PROMPT = `Tu es l'analyste immobilier de Lukka Place, une plateforme proptech à Kinshasa (République Démocratique du Congo).

Un agent immobilier, déjà connecté à son espace personnel, colle le texte brut d'une annonce (souvent rédigé pour WhatsApp : emojis, argot, mise en page libre) pour remplir automatiquement son formulaire. Produis uniquement les champs structurés demandés, plus une description propre pour la page publique.

CONTEXTE LINGUISTIQUE ET MONÉTAIRE — mêmes règles que pour l'intake WhatsApp :
- Texte en français, lingala, ou mélange des deux. "pièces" = total des pièces, PAS les chambres. "chambre salon" = 1 chambre.
- Loyers et prix sont presque toujours en dollars ; "$"/"usd"/"dollars" => USD, "FC"/"CDF"/"francs" => CDF. Sans devise indiquée et montant plausible en USD, utilise USD.
- Sépare le loyer mensuel du prix de vente : "$/mois" => price_period "mois" ; une vente => price_period "total".

CONDITIONS D'ENTRÉE — NOTATION "3 + 1 + 1" (convention de Kinshasa), IDENTIQUE à l'intake WhatsApp :
- Ces nombres sont des POSTES DISTINCTS. Ne les additionne JAMAIS — "3 + 1 + 1" ne veut PAS dire 5 mois.
  * 1er nombre => deposit_months (garantie locative seule, restituable).
  * 2e nombre => advance_months (loyer payé d'avance).
  * 3e nombre => commission_months (frais d'agence/commissionnaire).
- Deux nombres seulement ("4+1") => deposit_months + advance_months, commission_months null.
- Un seul nombre ("Garantie : 3 mois") => deposit_months uniquement.
- Ne mets jamais un total dans deposit_months.

LOCALISATION — mêmes 24 communes et orthographes normalisées que l'intake WhatsApp :
${LOCATIONS_BLOCK}
- Normalise la commune vers l'une de ces orthographes exactes. La référence précise (nom de résidence, repère informel) va dans "quartier", jamais dans "commune".
- Un code/numéro de référence explicite ("Réf:", "Référence:") va dans "reference", distinct du quartier.

CLASSIFICATION DU TYPE DE BIEN — mêmes règles que l'intake WhatsApp :
1. PARCELLE : dimensions de terrain, propriété clôturée, "Maison Type Locataire" ou "Portes" => property_type "parcelle". Sous-type (parcelle_subtype, uniquement si property_type = "parcelle") : "maison_type_locataire", "villa", "terrain_nu". NE classe JAMAIS "appartement" uniquement à cause d'une superficie ou de plusieurs pièces/portes.
2. APPARTEMENT : uniquement si le message décrit explicitement un logement dans un immeuble à étages ou une résidence collective.
3. "X Portes" / "Type Locataire" => units_count = X.

RÈGLES D'EXTRACTION
1. N'invente rien. Tout champ absent du message doit être null. Une annonce partielle est normale.
2. Ne convertis pas les devises ; rapporte le montant et la devise tels qu'écrits.
3. Convertis les dimensions en superficie ("20x30" => 600 m²), la virgule est un séparateur décimal.
4. title_suggestion : un titre court (moins de 80 caractères), en français correct, casse normale (pas de MAJUSCULES, pas d'emoji), ex. "Appartement 3 chambres à louer à Kinshasa, Plateau".
5. description_fr : un texte de PROSE fluide et professionnelle (2 à 4 phrases, pas de liste à puces, pas de titre séparé), en français, casse normale (jamais de MAJUSCULES), sans emoji, sans formatage WhatsApp (astérisques, puces). Le ton est engageant et soigné, mais chaque phrase ne fait que reformuler des faits RÉELLEMENT présents dans le texte source — voir le GARDE-FOU ANTI-HALLUCINATION ci-dessous. Les équipements sont déjà affichés séparément sous forme de badges sur la page : ce texte n'a pas besoin de tous les répéter en liste, une phrase qui les mentionne naturellement suffit.
   N'inclus JAMAIS le prix, la garantie, ni une quelconque coordonnée de contact dans ce texte : ce sont des champs séparés, gérés ailleurs sur la page.
6. confidence : 0.9+ pour une annonce claire, ~0.5 pour un message vague, <0.3 si le texte ne ressemble probablement pas à une annonce.

GARDE-FOU ANTI-HALLUCINATION (règle absolue — prime sur le style et sur l'envie d'étoffer le texte)
- N'ajoute, n'insinue ou ne suppose AUCUN équipement, caractéristique ou avantage qui n'est pas écrit explicitement dans le texte source — même s'il est courant pour ce type de bien à Kinshasa. Un appartement n'a pas forcément de parking, de balcon, de climatisation ou de groupe électrogène : n'en parle QUE si le texte le mentionne réellement.
- Si le texte ne mentionne aucun équipement précis, la description peut se limiter à une phrase sur la composition (ex. "Cet appartement de 3 chambres et un salon est à louer à Gombe.") — ne complète jamais avec des suppositions pour donner l'impression d'un bien mieux équipé.
- En cas de doute sur le sens exact d'une abréviation ou d'un terme ambigu, OMETS-le plutôt que de deviner ce qu'il désigne.
- Un descriptif honnête et incomplet vaut toujours mieux qu'un descriptif complet mais partiellement inventé.`;

const LISTING_FORM_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'lukka_listing_form_extraction',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'title_suggestion', 'transaction_type', 'property_type', 'parcelle_subtype',
        'commune', 'quartier', 'reference', 'price', 'currency', 'price_period',
        'deposit_months', 'advance_months', 'commission_months', 'bedrooms', 'bathrooms',
        'surface_area_sqm', 'units_count', 'furnished', 'description_fr', 'confidence',
      ],
      properties: {
        title_suggestion: { type: ['string', 'null'], description: 'Titre court suggéré, casse normale, sans emoji.' },
        transaction_type: { type: ['string', 'null'], enum: ['location', 'vente', null] },
        property_type: { type: ['string', 'null'], enum: [...PROPERTY_TYPES, null] },
        parcelle_subtype: { type: ['string', 'null'], enum: [...PARCELLE_SUBTYPES, null] },
        commune: { type: ['string', 'null'] },
        quartier: { type: ['string', 'null'] },
        reference: { type: ['string', 'null'] },
        price: { type: ['number', 'null'] },
        currency: { type: ['string', 'null'], enum: ['USD', 'CDF', 'EUR', null] },
        price_period: { type: ['string', 'null'], enum: ['mois', 'an', 'total', null] },
        deposit_months: { type: ['integer', 'null'] },
        advance_months: { type: ['integer', 'null'] },
        commission_months: { type: ['integer', 'null'] },
        bedrooms: { type: ['integer', 'null'] },
        bathrooms: { type: ['integer', 'null'] },
        surface_area_sqm: { type: ['number', 'null'] },
        units_count: { type: ['integer', 'null'] },
        furnished: { type: ['boolean', 'null'] },
        description_fr: {
          type: 'string',
          description: 'Prose fluide de 2-4 phrases (pas de liste à puces, pas de titre séparé), casse normale, sans emoji ni astérisque. Chaque fait mentionné doit être explicitement présent dans le texte source — jamais une supposition.',
        },
        confidence: { type: 'number' },
      },
    },
  },
};

/**
 * Extract structured form fields + a clean description from raw agent-pasted
 * text (web/'s Smart Paste). Text-only by design — the dashboard form already
 * has its own dedicated photo uploader, unlike the WhatsApp intake pipeline.
 *
 * @param {string} rawText
 * @returns {Promise<{extracted_data: Object, _meta: Object}>}
 */
async function parseListingTextForForm(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    throw new Error('parseListingTextForForm requires non-empty text');
  }

  const completion = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: LISTING_FORM_RESPONSE_FORMAT,
    messages: [
      { role: 'system', content: LISTING_FORM_SYSTEM_PROMPT },
      { role: 'user', content: `--- TEXTE COLLÉ ---\n${text}\n--- FIN ---` },
    ],
  });

  const choice = completion.choices?.[0];
  if (choice?.message?.refusal) {
    throw new Error(`Model refused the request: ${choice.message.refusal}`);
  }
  if (choice?.finish_reason === 'length') {
    throw new Error('Model output was truncated (finish_reason: length)');
  }

  const raw = choice?.message?.content;
  if (!raw) {
    throw new Error(`Model returned no content (finish_reason: ${choice?.finish_reason || 'unknown'})`);
  }

  let extracted_data;
  try {
    extracted_data = JSON.parse(raw);
  } catch {
    throw new Error(`Model returned non-JSON output: ${String(raw).slice(0, 200)}`);
  }

  return {
    extracted_data,
    _meta: {
      model: completion.model || MODEL,
      usage: completion.usage || null,
      finish_reason: choice.finish_reason,
    },
  };
}

module.exports = {
  parseMessage,
  draftContextFromListing,
  INTAKE_HISTORY_LIMIT,
  toImagePart,
  // Exposed so services/embeddings.js can reuse the same lazy client/auth
  // (same OPENAI_API_KEY, same lazy-throw-if-missing behaviour) for
  // embedding calls rather than a second client implementation.
  getClient,
  SYSTEM_PROMPT,
  RESPONSE_FORMAT,
  KINSHASA_COMMUNES,
  PROPERTY_TYPES,
  PARCELLE_SUBTYPES,
  MISSING_FIELD_KEYS,
  SUPPORTED_IMAGE_MIME_TYPES,
  MAX_IMAGES,

  // Smart Paste (agent dashboard) — additive, does not change parseMessage.
  parseListingTextForForm,
  LISTING_FORM_SYSTEM_PROMPT,
  LISTING_FORM_RESPONSE_FORMAT,

  // Buyer assistant (see the section above) — additive, does not change
  // anything exported above this point.
  BUYER_SYSTEM_PROMPT,
  BUYER_TOOLS,
  BUYER_ASSISTANT_FALLBACK_REPLY,
  BUYER_MAX_TOOL_ITERATIONS,
  runBuyerTurn,
  executeBuyerTool,
  executeSearchProperties,
  executeGetProperty,
  executeGetLocation,
  executeCreateEnquiry,
  executeRequestViewing,
  executeHandoffToAgent,
};
