/**
 * The owner's live report (app/(site)/rapport/[token]/page.js) — the pure
 * wording. French always: the report is read by landlords, the same market
 * the share captions are written for.
 *
 * Same honesty rules as the weekly card (mandateReportCopy.js): each number
 * says what it counts; an unknown number is "non disponible", never 0; and
 * the market line appears only above the minimum sample, with that sample
 * printed beside it.
 */

const dateFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' });

export function frenchDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFr.format(date);
}

const NBSP = /[  ]/g;
export const money = (amount) => `${Math.round(Number(amount)).toLocaleString('fr-FR').replace(NBSP, ' ')} $`;

/** "depuis 23 jours", "depuis aujourd'hui". */
export function daysText(days) {
  if (days == null) return null;
  if (days === 0) return 'depuis aujourd’hui';
  return `depuis ${days} jour${days > 1 ? 's' : ''}`;
}

const SCOPE_TEXT = {
  beds: 'de même type et même nombre de chambres',
  type: 'de même type',
  commune: '',
};

/**
 * "Loyer médian demandé pour 7 biens comparables à Kintambo (même type et
 * même nombre de chambres) : 1 200 $ / mois. Ce bien : +8 %."
 * Below the minimum sample it says how many comparables exist, no figure.
 */
export function marketPositionText(position, listing) {
  if (!position || !listing?.commune) return null;
  const rent = listing.purpose === 'rent';
  if (position.median == null) {
    return position.n > 0
      ? `Pas encore assez d’annonces comparables à ${listing.commune} pour une médiane fiable (${position.n}).`
      : null;
  }
  const scope = SCOPE_TEXT[position.scope] ? ` ${SCOPE_TEXT[position.scope]}` : '';
  const figure = `${money(position.median)}${rent ? ' / mois' : ''}`;
  const head = `${rent ? 'Loyer' : 'Prix'} médian demandé pour ${position.n} biens comparables${scope} à ${listing.commune} : ${figure}.`;
  if (position.differencePct == null) return head;
  if (Math.abs(position.differencePct) < 3) return `${head} Ce bien est au niveau du marché.`;
  const sign = position.differencePct > 0 ? '+' : '−';
  return `${head} Ce bien : ${sign}${Math.abs(position.differencePct)} %.`;
}

export const WHAT_IS_COUNTED =
  'Mesuré sur lukkaplace.com : ouvertures de la page de l’annonce, personnes différentes (un même téléphone compte une fois), photos parcourues, appuis sur les boutons WhatsApp et « Appeler », mises en favori, partages et demandes de visite. Toutes les ouvertures sont comptées, y compris celles de l’agent et des outils automatiques.';

export const WHAT_IS_NOT_COUNTED =
  'Ne sont pas comptés : les appels et messages envoyés à l’agent sans passer par la page, et les personnes qui ont vu l’annonce sur un statut ou dans un groupe WhatsApp sans ouvrir le lien.';

export function sinceNote(trackingStartedAt) {
  const date = frenchDate(`${trackingStartedAt}T12:00:00Z`);
  return date ? `* Mesuré depuis le ${date}.` : null;
}
