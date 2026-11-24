/**
 * The fiche pratique — power, water, access in the rainy season, visit fee —
 * as the agent answered it on WhatsApp on 2026-11-12, the one day the
 * questions were asked after "OK"; they no longer are (engine
 * services/practicalFacts.js). Pure: the listing page reads it, the tests pin it.
 *
 * NULL is "not answered", never "no". Shown as "Réponses de l'agence", never
 * "vérifié": nobody from Lukka Place has checked the road in the rain.
 *
 * The value lists are DUPLICATED in the engine module and in the CHECKs of
 * migrations/20261112_listing_practical_facts.sql — change all three together
 * (tests/unit/practical-facts.test.js compares them).
 */

import { LISTING_TIME_ZONE } from './listingView';

export const POWER_SUPPLY = Object.freeze(['snel', 'snel_groupe', 'snel_solaire']);
export const WATER_SUPPLY = Object.freeze(['regideso', 'regideso_citerne', 'forage']);
export const RAINY_ACCESS = Object.freeze(['bon', 'difficile', 'inonde']);

/** The columns, read through to_jsonb so a database without them yields nulls, not 42703. */
export const PRACTICAL_COLUMNS = Object.freeze(['power_supply', 'water_supply', 'rainy_access', 'visit_fee', 'practical_answered_at']);

export const PRACTICAL_SQL = `(SELECT jsonb_build_object(${PRACTICAL_COLUMNS.map((c) => `'${c}', j -> '${c}'`).join(', ')})
   FROM (SELECT to_jsonb(p) AS j) fiche)`;

function oneOf(value, allowed) {
  return allowed.includes(value) ? value : null;
}

/**
 * The answers on a row's `practical_facts` jsonb (or the row itself), cleaned:
 * unknown values dropped, visit_fee a boolean or null. `answeredAt` is an ISO
 * string or null.
 */
export function practicalFactsOf(source) {
  const s = source && typeof source === 'object' ? source : {};
  const fee = s.visit_fee;
  const answeredAt = s.practical_answered_at ? new Date(s.practical_answered_at) : null;
  return {
    powerSupply: oneOf(s.power_supply, POWER_SUPPLY),
    waterSupply: oneOf(s.water_supply, WATER_SUPPLY),
    rainyAccess: oneOf(s.rainy_access, RAINY_ACCESS),
    visitFee: fee === true || fee === 'true' ? true : fee === false || fee === 'false' ? false : null,
    answeredAt: answeredAt && !Number.isNaN(answeredAt.getTime()) ? answeredAt.toISOString() : null,
  };
}

export function hasPracticalFacts(facts) {
  return Boolean(facts && (facts.powerSupply || facts.waterSupply || facts.rainyAccess || facts.visitFee !== null));
}

/**
 * The rows of the card, in the order the agent was asked. Each carries an
 * i18n key for its label and one for its value; `valueKey` is null when the
 * agent did not answer that one, and the page prints "Non indiqué".
 * `tone` marks the answers a visitor should notice: a flooded road and a
 * paid visit.
 *
 * The visit-fee question is no longer asked (owner, 2026-11-12), so its row
 * appears only on a listing whose agent answered it before — never as
 * "Non indiqué" on every new listing.
 */
export function practicalRows(facts) {
  const f = facts || {};
  const rows = [
    { id: 'power', icon: 'zap', labelKey: 'listings.practical.power', valueKey: f.powerSupply ? `listings.practical.powerValues.${f.powerSupply}` : null, tone: null },
    { id: 'water', icon: 'droplets', labelKey: 'listings.practical.water', valueKey: f.waterSupply ? `listings.practical.waterValues.${f.waterSupply}` : null, tone: null },
    {
      id: 'access',
      icon: 'route',
      labelKey: 'listings.practical.access',
      valueKey: f.rainyAccess ? `listings.practical.accessValues.${f.rainyAccess}` : null,
      tone: f.rainyAccess === 'inonde' || f.rainyAccess === 'difficile' ? 'warning' : null,
    },
    {
      id: 'fee',
      icon: 'ticket',
      labelKey: 'listings.practical.visitFee',
      valueKey: f.visitFee === null || f.visitFee === undefined ? null : f.visitFee ? 'listings.practical.feeValues.oui' : 'listings.practical.feeValues.non',
      tone: f.visitFee === true ? 'warning' : null,
    },
  ];
  return f.visitFee === null || f.visitFee === undefined ? rows.filter((r) => r.id !== 'fee') : rows;
}

const ANSWERED_FORMATTERS = {
  fr: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: LISTING_TIME_ZONE }),
  en: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: LISTING_TIME_ZONE }),
};

/** "12 novembre 2026" on the Kinshasa calendar, or null. */
export function answeredDateLabel(answeredAt, locale = 'fr') {
  if (!answeredAt) return null;
  const date = new Date(answeredAt);
  if (Number.isNaN(date.getTime())) return null;
  return (ANSWERED_FORMATTERS[locale] || ANSWERED_FORMATTERS.fr).format(date);
}
