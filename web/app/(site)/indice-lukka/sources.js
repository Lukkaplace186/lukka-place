import { SOURCE_NAMES } from '@/lib/marketObservationRules';

/** A market source's public name, the same wording as the price guide's. */
export function sourceName(t, source) {
  if (source === 'whatsapp_group') return t('home.prices.sourceWhatsapp');
  if (source === 'other') return t('home.prices.sourceOther');
  return SOURCE_NAMES[source] || source;
}

/** Sources by count, largest first, as one readable list. Counts are before de-duplication, so never summed. */
export function sourceList(t, sources) {
  return Object.entries(sources || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source]) => sourceName(t, source))
    .join(', ');
}

/** 'YYYY-MM-DD' → "11 novembre 2026" / "11 November 2026". */
export function dayLabel(day, locale) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
