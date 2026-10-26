import 'server-only';
import { CITIES, groupCommunesByCity } from '@/lib/cities';
import { BLOG_PROPERTY_TYPES } from '@/lib/blogRules';

/**
 * The editor's select options, labelled on the server: communes grouped by
 * city (lib/cities.js — every city the site covers) and the landing pages'
 * property types, whose plural labels live in a namespace the console does
 * not ship to the browser.
 */
export function editorOptions(t) {
  const communeGroups = groupCommunesByCity(CITIES.flatMap((city) => city.communes.map((c) => c.key)));
  const typeOptions = BLOG_PROPERTY_TYPES.map((type) => ({ value: type.value, label: t(type.labelKey) }));
  return { communeGroups, typeOptions };
}
