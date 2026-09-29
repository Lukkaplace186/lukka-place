/**
 * The listing funnel's steps, in order, and how each is read — pure, shared
 * by the agent's listing page and the landlord's live report so both list the
 * same steps the same way.
 *
 * `since` marks a step that only exists from lib/listingPerformance.js's
 * TRACKING_STARTED_AT: a window reaching back before it is under-counted
 * there, and both pages say so rather than letting "0 appels en août" pass
 * for a fact.
 */

export const FUNNEL_STEPS = [
  { key: 'views' },
  { key: 'people', since: true },
  { key: 'galleryPeople', since: true },
  { key: 'galleryCompletePeople', since: true },
  { key: 'whatsappClicks' },
  { key: 'calls', since: true },
  { key: 'saves' },
  { key: 'shares', since: true },
  { key: 'visitRequests' },
];

/**
 * French, always, on the owner's report — the same rule as every text an
 * agent forwards to their market (lib/listingShareCopy.js).
 */
export const FUNNEL_LABELS_FR = {
  views: 'Vues de l’annonce',
  people: 'Personnes différentes',
  galleryPeople: 'Ont regardé les photos',
  galleryCompletePeople: 'Ont vu toutes les photos',
  whatsappClicks: 'Clics sur WhatsApp',
  calls: 'Appuis sur « Appeler »',
  saves: 'Mises en favori',
  shares: 'Partages de l’annonce',
  visitRequests: 'Demandes de visite',
};

/**
 * Rows ready to draw: value, previous value (or null), and the bar's share of
 * the widest step. A null value stays null ("non disponible") and draws no
 * bar; it is never shown as 0.
 *
 * @param {{current: object, previous?: object|null}} counts
 * @param {Record<string, string>} labels
 */
export function funnelRows(counts, labels) {
  const current = counts?.current || {};
  const previous = counts?.previous || null;
  const widest = Math.max(1, ...FUNNEL_STEPS.map(({ key }) => Number(current[key]) || 0));
  return FUNNEL_STEPS.map(({ key, since }) => {
    const value = current[key] == null ? null : Number(current[key]);
    const before = previous && previous[key] != null ? Number(previous[key]) : null;
    return {
      key,
      label: labels[key] || key,
      value,
      previous: before,
      share: value == null ? 0 : value / widest,
      since: Boolean(since),
    };
  });
}

/**
 * "+12 %", "−40 %", "=", or null when there is nothing to compare with — a
 * change from zero is not a percentage.
 */
export function changeText(value, previous) {
  if (value == null || previous == null || previous === 0) return null;
  const pct = Math.round(((value - previous) / previous) * 100);
  if (pct === 0) return '=';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)} %`;
}
