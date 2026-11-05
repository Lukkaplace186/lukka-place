/**
 * lib/marketObservationRules.js — pure rules for market observations
 * (asking prices seen outside Lukka Place's own public listings; engine
 * services/marketObservations.js and migrations/20261104_market_observations.sql).
 *
 * No `server-only`: the admin entry form (client) validates with the same
 * function the Server Action runs, and the unit tests import it directly.
 * The engine holds the same source list and kinds — change one, change the
 * other (tests/unit/market-observations.test.js compares them).
 */

/** Every source the table's CHECK accepts, in display order. */
export const MARKET_SOURCES = ['whatsapp_group', 'smartimmo', 'mediacongo', 'imcongo', 'immo24', 'alain_realty', 'facebook', 'zwandako', 'other'];

/** Collected by the engine every night. */
export const COLLECTED_SOURCES = ['whatsapp_group', 'immo24', 'imcongo', 'alain_realty', 'smartimmo', 'mediacongo'];

/** Entered by hand from /admin/market-data/marche — their terms forbid automated collection. */
export const MANUAL_SOURCES = ['facebook', 'zwandako', 'other'];

/** Display names. Brand names are not translated. */
export const SOURCE_NAMES = {
  lukka: 'Lukka Place',
  whatsapp_group: 'Groupes WhatsApp',
  smartimmo: 'SmartImmo',
  mediacongo: 'MediaCongo',
  imcongo: 'IMCongo',
  immo24: 'Immo24',
  alain_realty: 'Alain Realty',
  facebook: 'Facebook',
  zwandako: 'Zwandako',
  other: 'Autre',
};

/** Source home pages, for the method note. */
export const SOURCE_URLS = {
  smartimmo: 'https://www.smartimmo-app.com',
  mediacongo: 'https://www.mediacongo.net',
  imcongo: 'https://www.imcongo.com',
  immo24: 'https://immo24.cd',
  alain_realty: 'https://alain-realty.net',
  zwandako: 'https://zwandako.com',
};

/** Kinds a rent median counts (a home). Others are stored but never in the guide. */
export const RESIDENTIAL_KINDS = ['appartement', 'maison', 'villa', 'studio', 'duplex', 'penthouse'];
export const PROPERTY_KINDS = [...RESIDENTIAL_KINDS, 'chambre', 'terrain', 'bureau', 'commercial', 'immeuble', 'autre'];

export const PRICE_PERIODS = ['mois', 'an', 'total', 'jour', 'semaine'];

/**
 * An observation counts while the advert is from the last year AND was still
 * online at its source in the last 60 days (a group capture is never
 * "removed", so only its age applies — the engine refreshes it nightly).
 */
export const MARKET_WINDOW_DAYS = 365;
export const STILL_LISTED_DAYS = 60;

/**
 * Recent adverts weigh more in a median and its range (owner, 2026-11-05):
 * one posted in the last RECENT_DAYS (three months) counts RECENT_WEIGHT
 * times, an older one once. Only the figure is weighted — the number of
 * listings a guide states is still the real count. "Posted" is the advert's
 * own date when the source gives one, else the day we first saw it; a Lukka
 * Place listing's is the later of created / moderated.
 */
export const RECENT_DAYS = 92;
export const RECENT_WEIGHT = 2;

/** Rent per month must sit here, as in the engine's BOUNDS. */
export const RENT_BOUNDS = { min: 30, max: 20000 };
export const SALE_BOUNDS = { min: 1000, max: 20000000 };

/** Excluded by hand: stored as 'manual:<code>' so a nightly refresh keeps it. */
export const MANUAL_EXCLUSION_CODES = ['duplicate', 'wrong_price', 'wrong_place', 'not_residential', 'stale', 'other'];

const intOrNull = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/\s/g, ''));
  return Number.isInteger(n) ? n : NaN;
};

const amountOrNull = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(String(value).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Validates a hand-entered observation. Returns `{ ok: true, value }` with
 * the row to insert (monthly_usd derived, never typed), or
 * `{ ok: false, error }` where error is an i18n key suffix under
 * admin.marketObservations.errors.
 *
 * @param {object} input raw form values
 * @param {{communes?: string[], now?: Date}} [options] communes = the allow-list
 */
export function validateManualObservation(input, { communes = [], now = new Date(), requireUrl = true } = {}) {
  const source = String(input.source || '');
  if (!MANUAL_SOURCES.includes(source)) return { ok: false, error: 'source' };

  let url = String(input.source_url || '').trim();
  if (url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: 'url' };
      url = parsed.toString();
    } catch {
      return { ok: false, error: 'url' };
    }
  }
  // A link is what makes a hand entry checkable later; Facebook groups are
  // the one place a post may have no shareable link, so "other" and Zwandako
  // must carry one and Facebook may not.
  // A batch paste ("Coller des annonces") keys each advert on its own facts
  // instead (pasteSourceRef in lib/marketProspectRules.js), so it may come
  // with no link at all.
  if (!url && source !== 'facebook' && requireUrl) return { ok: false, error: 'urlRequired' };

  const purpose = input.purpose === 'sale' ? 'sale' : input.purpose === 'rent' ? 'rent' : null;
  if (!purpose) return { ok: false, error: 'purpose' };

  const kind = String(input.property_kind || '');
  if (!PROPERTY_KINDS.includes(kind)) return { ok: false, error: 'kind' };

  const beds = intOrNull(input.beds);
  if (Number.isNaN(beds) || (beds !== null && (beds < 0 || beds > 30))) return { ok: false, error: 'beds' };

  const price = amountOrNull(input.price);
  if (price === null || Number.isNaN(price) || price <= 0) return { ok: false, error: 'price' };

  const currency = input.currency === 'CDF' ? 'CDF' : 'USD';
  if (currency !== 'USD') return { ok: false, error: 'currency' };

  const period = purpose === 'sale' ? 'total' : String(input.price_period || 'mois');
  if (!PRICE_PERIODS.includes(period)) return { ok: false, error: 'period' };
  if (purpose === 'rent' && !['mois', 'an'].includes(period)) return { ok: false, error: 'shortStay' };

  const monthly = purpose === 'rent' ? (period === 'an' ? Math.round((price / 12) * 100) / 100 : price) : null;
  if (purpose === 'rent' && (monthly < RENT_BOUNDS.min || monthly > RENT_BOUNDS.max)) return { ok: false, error: 'priceRange' };
  if (purpose === 'sale' && (price < SALE_BOUNDS.min || price > SALE_BOUNDS.max)) return { ok: false, error: 'priceRange' };

  const commune = String(input.commune || '');
  if (!commune || (communes.length && !communes.includes(commune))) return { ok: false, error: 'commune' };

  let postedAt = null;
  if (input.posted_at) {
    const date = new Date(`${String(input.posted_at).slice(0, 10)}T12:00:00+01:00`);
    if (Number.isNaN(date.getTime())) return { ok: false, error: 'date' };
    if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) return { ok: false, error: 'dateFuture' };
    if (date.getTime() < now.getTime() - MARKET_WINDOW_DAYS * 24 * 60 * 60 * 1000) return { ok: false, error: 'dateOld' };
    postedAt = date.toISOString();
  }

  const furnished = input.furnished === 'yes' ? true : input.furnished === 'no' ? false : null;
  const quartier = String(input.quartier || '').trim().slice(0, 120) || null;
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;

  return {
    ok: true,
    value: {
      source,
      source_url: url || null,
      posted_at: postedAt,
      purpose,
      property_kind: kind,
      beds,
      furnished,
      price,
      currency,
      price_period: period,
      monthly_usd: monthly,
      price_usd: price,
      commune,
      quartier,
      title,
    },
  };
}

/**
 * The source_ref of a hand entry: its link when it has one (so the same
 * advert entered twice is one row), else a stamp unique to this entry.
 */
export function manualSourceRef(value, now = new Date()) {
  if (value.source_url) return `url:${value.source_url}`.slice(0, 300);
  return `manual:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`;
}

/** Engine extraction (POST /admin/parse-listing) → the entry form's fields. Never invents a commune. */
export function prefillFromExtraction(extracted, communes = []) {
  const e = extracted || {};
  const kindMap = {
    appartement: 'appartement', studio: 'studio', maison: 'maison', villa: 'villa', duplex: 'duplex',
    penthouse: 'penthouse', chambre: 'chambre', terrain: 'terrain', concession: 'terrain', ferme: 'terrain',
    bureau: 'bureau', boutique: 'commercial', entrepot: 'commercial', immeuble: 'immeuble',
  };
  let kind = kindMap[e.property_type] || '';
  if (e.property_type === 'parcelle') kind = String(e.parcelle_subtype || '').includes('villa') ? 'villa' : e.bedrooms ? 'maison' : 'terrain';
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const commune = communes.find((c) => fold(c) === fold(e.commune)) || '';
  return {
    purpose: e.transaction_type === 'vente' ? 'sale' : e.transaction_type === 'location' ? 'rent' : '',
    property_kind: kind,
    beds: Number.isInteger(e.bedrooms) ? String(e.bedrooms) : '',
    price: Number.isFinite(e.price) ? String(e.price) : '',
    currency: /cdf|fc/i.test(e.currency || '') ? 'CDF' : 'USD',
    price_period: ['mois', 'an', 'jour', 'semaine'].includes(e.price_period) ? e.price_period : 'mois',
    furnished: e.furnished === true ? 'yes' : e.furnished === false ? 'no' : '',
    commune,
    quartier: e.quartier || '',
  };
}
