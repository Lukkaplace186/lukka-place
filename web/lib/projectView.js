/**
 * Values derived from a project row for display — the /projets equivalent of
 * lib/listingView.js. Every function takes `t` as an argument (never a
 * module-level translator; web/CLAUDE.md, "t in a module-level constant").
 */
import { STAGE_LABEL_KEYS } from './developmentRules';
import { LISTING_TIME_ZONE } from './listingView';

export function projectKindLabel(project, t) {
  if (project.kind === 'land') return t('projects.kind.land');
  return project.stage === 'delivered' ? t('projects.kind.building') : t('projects.kind.offPlan');
}

export function stageLabel(project, t) {
  return project.stage ? t(STAGE_LABEL_KEYS[project.stage]) : null;
}

/** "Livraison prévue : T3 2027" is a guess we won't make — the stored date, as month + year. */
export function deliveryLabel(date, locale) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    month: 'long', year: 'numeric', timeZone: LISTING_TIME_ZONE,
  }).format(d);
}

export function shortDate(date, locale) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: LISTING_TIME_ZONE,
  }).format(d);
}

export function projectLocationLine(project) {
  return [project.quartier, project.commune].filter(Boolean).join(', ') || null;
}

/** "2 à 4 chambres", "3 chambres", or null. */
export function bedroomsRange(summary, t) {
  if (!summary || summary.bedsMin === null) return null;
  if (summary.bedsMin === summary.bedsMax) return t('projects.card.beds', { count: summary.bedsMin });
  return t('projects.card.bedsRange', { min: summary.bedsMin, max: summary.bedsMax });
}

/** The card's availability line: "7 disponibles sur 40", "12 lots disponibles", or null. */
export function availabilityLine(project, t) {
  if (project.kind === 'land') {
    const lots = project.lot_summary;
    if (!lots || lots.total === 0) return null;
    return lots.available > 0
      ? t('projects.card.lotsAvailable', { count: lots.available, total: lots.total })
      : t('projects.card.allLotsTaken');
  }
  const units = project.unit_summary;
  if (!units || units.available === null) return null;
  if (units.available === 0) return t('projects.card.soldOut');
  return units.total !== null
    ? t('projects.card.unitsAvailableOf', { count: units.available, total: units.total })
    : t('projects.card.unitsAvailable', { count: units.available });
}

/** "dès" price and purpose for the card, or null when nothing states a price. */
export function fromPrice(project) {
  if (project.kind === 'land') {
    const price = project.lot_summary?.priceMin ?? null;
    return price === null ? null : { amount: price, purpose: 'sale', period: null };
  }
  const summary = project.unit_summary;
  if (!summary || summary.priceMin === null) return null;
  const purpose = summary.purpose === 'rent' ? 'rent' : 'sale';
  return { amount: summary.priceMin, purpose, period: null };
}
