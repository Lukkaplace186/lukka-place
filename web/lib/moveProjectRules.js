/**
 * "Mon déménagement" (2026-11-07) — the move project a customer describes,
 * card by card, when they open an account (/compte/inscription) or later from
 * "Mon projet" (/compte/client/projet).
 *
 * Why: the marketing breakthrough of 2026-11-06 — people move for a reason
 * (a fourth child, a new job), and the product only ever asked "3 chambres à
 * Ngaliema". The questions live in the account, not on WhatsApp, because a
 * WhatsApp question only reaches someone inside the 24-hour window.
 *
 * Pure (shared by the client flow, the Server Actions and the tests): option
 * lists, the validator, and what the answers become — a saved search, the
 * French brief agencies read, the customer's own one-line story.
 *
 * Never invent: every field is optional, a skipped card is NULL / [] ("not
 * said"), and nothing is deduced from another answer — household size never
 * becomes a bedroom count, a workplace never becomes a commune. Priorities
 * (électricité, eau…) are told to agents and NOT turned into search filters:
 * few listings carry those tags yet, so a filter would hide most real homes.
 */
import { CITIES, DEFAULT_CITY, cityOfCommune, communeLabel, communesOfCity, findCity } from './cities';

export const MOVE_REASONS = Object.freeze(['famille', 'travail', 'couple', 'premier', 'budget', 'achat', 'retour', 'etudes', 'autre']);
/** "Location courte durée" is a rental with lease_term 'short' (lib/leaseTerm.js). */
export const MOVE_TRANSACTIONS = Object.freeze(['location', 'vente', 'courte']);
export const MOVE_HOUSEHOLDS = Object.freeze(['seul', 'deux', 'trois_quatre', 'cinq_six', 'sept_plus']);
/** 5 means "5 or more" — a minimum, like `beds_min`. */
export const MOVE_BEDROOMS = Object.freeze([1, 2, 3, 4, 5]);
export const MOVE_ANCHORS = Object.freeze(['travail', 'ecole', 'famille', 'aucun']);
export const MOVE_PRIORITIES = Object.freeze(['electricite', 'eau', 'securite', 'acces', 'cour', 'parking']);
export const MOVE_TIMELINES = Object.freeze(['asap', 'un_mois', 'trois_mois', 'regarde']);
export const MOVE_CURRENT_HOMES = Object.freeze(['appartement', 'maison', 'studio', 'chambre', 'famille']);

/**
 * Budget ceilings offered as chips, in USD. Monthly for a rental, total for a
 * purchase. None for a short stay: those listings are priced per day OR per
 * week (`price_period`), and one `price_max` cannot mean both.
 */
export const MOVE_BUDGETS = Object.freeze({
  location: Object.freeze([200, 400, 700, 1000, 2000]),
  vente: Object.freeze([30000, 60000, 100000, 200000, 500000]),
});

export const MAX_MOVE_COMMUNES = 5;
/** `leads.source` of a request sent from "Mon déménagement". A search request, so it shows among the customer's requests. */
export const MOVE_LEAD_SOURCE = 'move-project';
/** One push to agencies per project per day: each agency gets one alert, not a stream. */
export const MOVE_RESEND_AFTER_MS = 20 * 60 * 60 * 1000;
export const MAX_MOVE_NOTE = 80;

/**
 * The cards, in order. `key` is what `answered_steps` records; the account
 * card is the signup flow's last and is not a project step.
 */
export const MOVE_STEPS = Object.freeze(['reasons', 'transaction', 'household', 'bedrooms', 'anchor', 'communes', 'priorities', 'budget', 'timeline', 'current']);

const pick = (list, value) => (list.includes(value) ? value : null);

function pickMany(list, values, max = list.length) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    if (list.includes(v) && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function cleanNote(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MAX_MOVE_NOTE) : null;
}

/** A commune key we know (any city), or null. */
function knownCommune(key) {
  const value = String(key ?? '').trim();
  return value && cityOfCommune(value) ? value : null;
}

/**
 * Validates what a client posted. Unknown values are dropped (never an
 * error): the flow is a conversation, and a stale option must not cost the
 * customer their account. Returns the clean project and whether anything was
 * actually said.
 *
 * @param {object} raw
 * @returns {{project: object, hasAnswers: boolean}}
 */
export function parseMoveProject(raw = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const reasons = pickMany(MOVE_REASONS, input.reasons);
  const transaction = pick(MOVE_TRANSACTIONS, input.transaction);
  const cityRecord = findCity(input.city) || null;
  const city = cityRecord ? cityRecord.name : null;
  const cityCommunes = communesOfCity(city || DEFAULT_CITY);
  const communes = pickMany(cityCommunes, input.communes, MAX_MOVE_COMMUNES);
  const budgetChoices = MOVE_BUDGETS[transaction] || [];
  const budget = Number(input.budgetMax);
  const anchorKind = pick(MOVE_ANCHORS, input.anchorKind);
  const beds = Number(input.bedrooms);

  const project = {
    reasons,
    reasonOther: reasons.includes('autre') ? cleanNote(input.reasonOther) : null,
    transactionType: transaction === 'vente' ? 'vente' : transaction ? 'location' : null,
    leaseTerm: transaction === 'courte' ? 'short' : null,
    household: pick(MOVE_HOUSEHOLDS, input.household),
    bedroomsMin: MOVE_BEDROOMS.includes(beds) ? beds : null,
    anchorKind,
    // A place only for a real anchor; "peu importe" has none.
    anchorCommune: anchorKind && anchorKind !== 'aucun' ? knownCommune(input.anchorCommune) : null,
    anchorNote: anchorKind && anchorKind !== 'aucun' ? cleanNote(input.anchorNote) : null,
    city: communes.length ? city || DEFAULT_CITY : city,
    communes,
    priorities: pickMany(MOVE_PRIORITIES, input.priorities),
    budgetMax: budgetChoices.includes(budget) ? budget : null,
    timeline: pick(MOVE_TIMELINES, input.timeline),
    currentHomeType: pick(MOVE_CURRENT_HOMES, input.currentHomeType),
    currentCommune: knownCommune(input.currentCommune),
    answeredSteps: pickMany(MOVE_STEPS, input.answeredSteps),
  };

  const hasAnswers = Boolean(
    project.reasons.length || project.transactionType || project.household || project.bedroomsMin
      || project.anchorKind || project.communes.length || project.priorities.length || project.budgetMax
      || project.timeline || project.currentHomeType || project.currentCommune,
  );
  return { project, hasAnswers };
}

/** The transaction chip a stored project reopens on. */
export function transactionChoice(project) {
  if (!project?.transactionType) return null;
  if (project.transactionType === 'vente') return 'vente';
  return project.leaseTerm === 'short' ? 'courte' : 'location';
}

/**
 * The /listings query the project stands for, or null when it names neither
 * a transaction nor a commune (an alert on "everything" helps nobody).
 * Same parameter names as a /listings search (lib/searchQuery.js), so the
 * saved search, the alerts sweep and the results link all read it unchanged.
 */
export function moveSearchQuery(project) {
  if (!project) return null;
  const communes = project.communes || [];
  if (!project.transactionType && communes.length === 0) return null;
  const params = new URLSearchParams();
  if (project.transactionType) params.set('transaction_type', project.transactionType);
  if (project.leaseTerm) params.set('lease_term', project.leaseTerm);
  const city = findCity(project.city);
  if (city && city.name !== DEFAULT_CITY) params.set('ville', city.slug);
  if (communes.length) params.set('commune', communes[0]);
  if (communes.length > 1) params.set('communes', communes.join(','));
  if (project.bedroomsMin) params.set('beds_min', String(project.bedroomsMin));
  if (project.budgetMax) params.set('price_max', String(project.budgetMax));
  return params.toString();
}

// ---------------------------------------------------------------------------
// The French brief agencies read (always French: agencies read it, whatever
// the customer's display language — same rule as lib/guestRequestRules.js).
// ---------------------------------------------------------------------------

const REASON_FR = {
  famille: 'la famille s’agrandit',
  travail: 'nouveau travail',
  couple: 'mariage / vie à deux',
  premier: 'premier logement',
  budget: 'réduire son budget',
  achat: 'acheter au lieu de louer',
  retour: 'retour au pays / nouvelle ville',
  etudes: 'études',
};
const HOUSEHOLD_FR = { seul: '1 personne', deux: '2 personnes', trois_quatre: '3–4 personnes', cinq_six: '5–6 personnes', sept_plus: '7 personnes ou plus' };
const ANCHOR_FR = { travail: 'son travail', ecole: 'l’école des enfants', famille: 'sa famille' };
const PRIORITY_FR = { electricite: 'électricité stable', eau: 'eau', securite: 'sécurité', acces: 'accès facile', cour: 'une cour', parking: 'parking' };
const TIMELINE_FR = { asap: 'dès que possible', un_mois: 'dans le mois', trois_mois: 'dans 1 à 3 mois', regarde: 'regarde seulement pour l’instant' };
const CURRENT_FR = { appartement: 'un appartement', maison: 'une maison', studio: 'un studio', chambre: 'une chambre', famille: 'chez sa famille' };

/**
 * One or more lines for the lead's `requirements_summary`, story first (the
 * agent's card shows three lines). Only what the customer said; '' when they
 * said nothing about their life.
 */
export function moveStoryFr(project) {
  if (!project) return '';
  const parts = [];
  const reasons = (project.reasons || []).filter((r) => r !== 'autre').map((r) => REASON_FR[r]).filter(Boolean);
  if (project.reasonOther) reasons.push(`« ${project.reasonOther} »`);
  if (reasons.length) parts.push(`Projet : ${reasons.join(', ')}`);
  if (project.household) parts.push(HOUSEHOLD_FR[project.household]);
  if (project.anchorKind && ANCHOR_FR[project.anchorKind]) {
    const where = project.anchorCommune ? ` à ${communeLabel(project.anchorCommune)}` : '';
    const note = project.anchorNote ? ` (« ${project.anchorNote} »)` : '';
    parts.push(`veut être près de ${ANCHOR_FR[project.anchorKind]}${where}${note}`);
  }
  if (project.currentHomeType) {
    const from = project.currentCommune ? ` à ${communeLabel(project.currentCommune)}` : '';
    parts.push(project.currentHomeType === 'famille' ? `vit aujourd’hui chez sa famille${from}` : `quitte ${CURRENT_FR[project.currentHomeType]}${from}`);
  }
  const priorities = (project.priorities || []).map((p) => PRIORITY_FR[p]).filter(Boolean);
  if (priorities.length) parts.push(`important : ${priorities.join(', ')}`);
  if (project.timeline) parts.push(`entrée : ${TIMELINE_FR[project.timeline]}`);
  return parts.join(' · ');
}

/** "Location · Gombe, Ngaliema · 4 chambres · Budget jusqu'à $800" — the criteria line, French. */
export function moveCriteriaFr(project) {
  if (!project) return '';
  const parts = [];
  if (project.transactionType === 'vente') parts.push('Achat');
  else if (project.leaseTerm === 'short') parts.push('Location courte durée');
  else if (project.transactionType === 'location') parts.push('Location');
  if (project.communes?.length) parts.push(project.communes.map(communeLabel).join(', '));
  if (project.bedroomsMin) parts.push(`${project.bedroomsMin}${project.bedroomsMin >= 5 ? '+' : ''} chambres`);
  if (project.budgetMax) parts.push(`Budget jusqu'à $${project.budgetMax.toLocaleString('en-US')}`);
  return parts.join(' · ');
}

/**
 * What can be sent to agencies: they are reached by commune
 * (services/leadDispatch.js), so a request needs a transaction and a commune.
 * @returns {null|'transaction'|'communes'} what is missing, or null when ready.
 */
export function moveRequestBlocker(project) {
  if (!project?.transactionType) return 'transaction';
  if (!project.communes?.length) return 'communes';
  return null;
}

/**
 * The customer's own one-line story, as i18n pieces for "Mon déménagement":
 * `{ from, to, when }`, each null when not said. Place names are data and
 * pass through untranslated.
 */
export function moveStoryParts(project) {
  if (!project) return { reasons: [], from: null, to: null, when: null };
  return {
    reasons: (project.reasons || []).filter((r) => r !== 'autre'),
    reasonOther: project.reasonOther || null,
    from: project.currentHomeType ? { type: project.currentHomeType, commune: project.currentCommune ? communeLabel(project.currentCommune) : null } : null,
    to: project.bedroomsMin || project.communes?.length
      ? { bedrooms: project.bedroomsMin || null, communes: (project.communes || []).map(communeLabel) }
      : null,
    when: project.timeline || null,
  };
}

/** Cities offered on the communes card, Kinshasa first (lib/cities.js order). */
export function moveCityOptions() {
  return CITIES.map((c) => ({ name: c.name, slug: c.slug }));
}

/**
 * The project a saved search already says (the save-search sign-up gate):
 * transaction, commune(s), bedrooms and budget, only when they are values
 * the cards can hold. Everything else stays unanswered.
 */
export function projectFromSearchQuery(query) {
  const params = new URLSearchParams(String(query || ''));
  const out = {};
  const tx = params.get('transaction_type');
  if (tx === 'vente') out.transaction = 'vente';
  else if (tx === 'location') out.transaction = params.get('lease_term') === 'short' ? 'courte' : 'location';
  const ville = params.get('ville');
  const city = (ville && findCity(ville)) || findCity(DEFAULT_CITY);
  const names = [params.get('commune'), ...String(params.get('communes') || '').split(',')].map((s) => String(s || '').trim()).filter(Boolean);
  const allowed = communesOfCity(city.name);
  const communes = [...new Set(names)].filter((n) => allowed.includes(n)).slice(0, MAX_MOVE_COMMUNES);
  if (communes.length) {
    out.city = city.name;
    out.communes = communes;
  }
  const beds = Number.parseInt(params.get('beds_min'), 10);
  if (MOVE_BEDROOMS.includes(beds)) out.bedrooms = beds;
  const budget = Number(params.get('price_max'));
  if (out.transaction && (MOVE_BUDGETS[out.transaction] || []).includes(budget)) out.budgetMax = budget;
  return out;
}

/** A stored project (lib/moveProjects.js row shape) back into the flow's answer shape. */
export function answersFromProject(project) {
  if (!project) return {};
  return {
    reasons: project.reasons || [],
    reasonOther: project.reasonOther || '',
    transaction: transactionChoice(project),
    household: project.household,
    bedrooms: project.bedroomsMin,
    anchorKind: project.anchorKind,
    anchorCommune: project.anchorCommune,
    anchorNote: project.anchorNote || '',
    city: project.city,
    communes: project.communes || [],
    priorities: project.priorities || [],
    budgetMax: project.budgetMax,
    timeline: project.timeline,
    currentHomeType: project.currentHomeType,
    currentCommune: project.currentCommune,
    answeredSteps: project.answeredSteps || [],
  };
}
