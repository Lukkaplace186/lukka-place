import { formatPrice } from '../format';
import { listingPublicUrl, shareBlocker } from '../listingShareCopy';

/**
 * "Rapport de diffusion" — the pure half: the reporting window, the card's
 * fields and the WhatsApp caption, from counts lib/marketing/mandateReport.js
 * read. French always, like every text an agent forwards to their market.
 *
 * WHAT THE NUMBERS ARE, SAID ON THE CARD AND IN THE CAPTION
 * An owner reading "42 vues" will take it as 42 interested people. It is not:
 * it is 42 openings of the listing page on lukkaplace.com, the agent's own
 * included, and it says nothing about the calls and direct WhatsApp messages
 * the agent received, which never pass through us (the same scope the admin
 * leaderboard states). The caption spells out both halves so the agent can
 * forward it without over-promising on our behalf.
 *
 * A count the server could not establish is `null` and prints as
 * "non disponible", never as 0 — zero visit requests and "the engine did not
 * answer" are different claims to make to a landlord.
 */

export const REPORT_DAYS = 7;
export const REPORT_UTM_SOURCE = 'rapport_proprietaire';

const DAY_MS = 86_400_000;

/**
 * Two back-to-back 7-day windows on whole UTC days, today included — the day
 * boundaries listing_stats_daily is rolled up on, so the rollup and the raw
 * fallback count exactly the same events.
 */
export function reportWindow(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = new Date(today + DAY_MS);
  const from = new Date(today - (REPORT_DAYS - 1) * DAY_MS);
  const previousFrom = new Date(from.getTime() - REPORT_DAYS * DAY_MS);
  return { previousFrom, from, end, lastDay: new Date(today) };
}

const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

export function periodText(window) {
  return `Du ${dayMonth.format(window.from)} au ${dayMonthYear.format(window.lastDay)}`;
}

const STATUS_TEXT = {
  live: 'En ligne sur lukkaplace.com',
  pending: 'En attente de validation',
  rejected: 'Refusée par la modération',
  archived: 'Hors ligne (archivée)',
  under_offer: 'Sous compromis',
};

export function statusText(listing) {
  const blocker = shareBlocker(listing);
  if (!blocker) return STATUS_TEXT.live;
  if (blocker === 'closed') return listing.purpose === 'sale' ? 'Vendu' : 'Loué';
  return STATUS_TEXT[blocker];
}

// Plain digits with a normal space: the fr-FR narrow no-break space renders as
// a tofu box in a font that lacks it.
const NON_BREAKING_SPACES = /[\u202f\u00a0]/g;
const count = (n) => Number(n).toLocaleString('fr-FR').replace(NON_BREAKING_SPACES, ' ');

const METRICS = [
  { key: 'views', label: 'Vues de l’annonce', caption: '👀 Vues de l’annonce' },
  { key: 'whatsappClicks', label: 'Clics WhatsApp', caption: '💬 Clics sur WhatsApp' },
  { key: 'saves', label: 'Mises en favori', caption: '❤️ Mises en favori' },
  { key: 'visitRequests', label: 'Demandes de visite', caption: '📅 Demandes de visite' },
];

export const REPORT_FOOTNOTE = 'Mesuré sur lukkaplace.com · appels et messages directs non comptés';

/**
 * @param {object} listing  getFlyerListing row.
 * @param {{current: object, previous: object}} counts  Each `{views, whatsappClicks, saves, visitRequests}`, numbers or null.
 * @param {{typeText, brand: {name, phone}, window}} options
 */
export function buildMandateReport(listing, counts, { typeText, brand, window }) {
  const place = [listing.quartier, listing.commune].filter(Boolean).join(', ');
  const tiles = METRICS.map(({ key, label }) => {
    const value = counts.current?.[key];
    const previous = counts.previous?.[key];
    if (value == null) return { key, label, value: '—', note: 'Non disponible pour le moment' };
    return { key, label, value: count(value), note: previous == null ? null : `Semaine précédente : ${count(previous)}` };
  });
  return {
    listingId: Number(listing.id),
    title: [typeText, place].filter(Boolean).join(' • ') || listing.title || `Annonce ${listing.id}`,
    priceText: formatPrice(listing.price, listing.purpose, listing.price_period),
    periodText: `7 derniers jours · ${periodText(window)}`,
    tiles,
    live: !shareBlocker(listing),
    statusText: statusText(listing),
    footnote: REPORT_FOOTNOTE,
    agentName: brand?.name || null,
    agentPhone: brand?.phone || null,
  };
}

export function buildMandateCaption(listing, report, counts) {
  const lines = [`📊 *Rapport de diffusion* — ${report.periodText}`, `🏠 ${report.title}`];
  if (report.priceText) lines.push(`💰 ${report.priceText}`);
  lines.push('');
  for (const { key, caption } of METRICS) {
    const value = counts.current?.[key];
    const previous = counts.previous?.[key];
    if (value == null) {
      lines.push(`${caption} : non disponible pour le moment`);
    } else {
      lines.push(`${caption} : *${count(value)}*${previous == null ? '' : ` (semaine précédente : ${count(previous)})`}`);
    }
  }
  lines.push('', `${report.live ? '✅' : '⏸️'} Statut : ${report.statusText.charAt(0).toLowerCase()}${report.statusText.slice(1)}`);
  if (report.live) lines.push(`👉 ${listingPublicUrl(listing.id, { source: REPORT_UTM_SOURCE })}`);
  lines.push(
    '',
    'ℹ️ Ce que ces chiffres comptent : les ouvertures de la page de l’annonce sur lukkaplace.com (y compris celles de l’agent), les appuis sur son bouton WhatsApp, les mises en favori et les demandes de visite reçues via Lukka Place.',
    'Ce qu’ils ne comptent pas : les appels et messages envoyés directement à l’agent, ni les personnes qui ont vu l’annonce sur un statut ou dans un groupe sans ouvrir le lien.',
  );
  return lines.join('\n');
}
