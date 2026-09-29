import { MIN_SAMPLE } from './marketBenchmarks';

/**
 * Pure half of the commune market report (lib/communeReport.js): sample
 * suppression, bedroom buckets and the French wording printed on the report.
 * French always — it is handed to banks and developers in Kinshasa, like the
 * print sheets.
 */

/** A median shown only at MIN_SAMPLE or more; rounded; null otherwise. */
export function suppressed(value, sample) {
  if (value == null || !(Number(sample) >= MIN_SAMPLE)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export const bedsBucket = {
  ORDER: ['0', '1', '2', '3', '4+', 'na'],
  order(bucket) {
    const i = this.ORDER.indexOf(bucket);
    return i === -1 ? this.ORDER.length : i;
  },
  label(bucket) {
    if (bucket === 'na') return 'Chambres non précisées';
    if (bucket === '0') return 'Studio / sans chambre';
    if (bucket === '4+') return '4 chambres et plus';
    return bucket === '1' ? '1 chambre' : `${bucket} chambres`;
  },
};

/** One SUPPLY_SQL row as the report prints it. `level`: 0 type × beds, 1 type, 3 commune total. */
export function summariseSupplyRow(row) {
  const priced = Number(row.priced) || 0;
  return {
    level: Number(row.level),
    type: row.type,
    beds: row.beds_bucket,
    listings: Number(row.listings) || 0,
    priced,
    p25: suppressed(row.p25, priced),
    median: suppressed(row.median, priced),
    p75: suppressed(row.p75, priced),
    medianPerSqm: suppressed(row.median_per_sqm, row.sqm_sample),
    sqmSample: Number(row.sqm_sample) || 0,
    medianAgeDays: suppressed(row.median_age_days, row.listings),
  };
}

const NBSP = /[  ]/g;
export const usd = (amount) => (amount == null ? '—' : `${Math.round(Number(amount)).toLocaleString('fr-FR').replace(NBSP, ' ')} $`);

export const REPORT_COPY = {
  title: (commune) => `Rapport de marché — ${commune}`,
  purpose: (purpose) => (purpose === 'sale' ? 'Vente' : 'Location (loyer mensuel)'),
  source:
    'Source : Lukka Place (lukkaplace.com). Annonces publiées et validées par notre équipe, transactions déclarées par les agents, recherches et demandes des clients sur la plateforme. Comptes de test exclus.',
  rule: `Une médiane n’est donnée qu’à partir de ${MIN_SAMPLE} observations ; en dessous, le nombre est indiqué et la valeur est « — ». Les prix sont des prix DEMANDÉS, sauf mention « obtenu ».`,
  supplyTitle: 'Offre actuelle',
  supplyByType: 'Par type et nombre de chambres',
  seriesTitle: 'Évolution sur 12 mois',
  seriesEmpty: 'Les relevés mensuels commencent en octobre 2026 : aucun mois n’est encore enregistré.',
  closesTitle: 'Transactions conclues (24 derniers mois)',
  closesNone: 'Aucune transaction avec un prix obtenu n’a encore été déclarée dans cette commune.',
  demandTitle: 'Demande (90 derniers jours)',
  searchesUnavailable: 'Les recherches ne sont pas encore enregistrées.',
  requestsUnavailable: 'Les demandes clients ne sont pas disponibles pour le moment.',
  limits:
    'Limites : les biens proposés hors plateforme ne sont pas comptés ; les délais de conclusion dépendent de la date déclarée par l’agent ; une surface n’est retenue que lorsqu’elle est un nombre simple (pas « 12x20 »).',
};

/** "12 recherches · 8 personnes · 3 sans résultat". */
export function demandLine({ searches, people, unserved }) {
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  return [plural(searches, 'recherche', 'recherches'), plural(people, 'personne', 'personnes'), `${unserved} sans résultat`].join(' · ');
}
