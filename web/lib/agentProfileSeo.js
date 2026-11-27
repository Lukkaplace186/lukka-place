/**
 * Agent profile pages (/agents/[id]) for search engines and link previews
 * (2026-11-21, marketing plan). Pure: no database, safe in a test.
 *
 * Every value comes from the agent's own row and their public listings:
 * the public name, the communes they declared, the count of their live
 * listings (the public gate), their logo, a listing photo. Nothing is
 * invented: a missing fact drops its part of the sentence.
 */

const PHONE_SHAPED = /^\+?\d[\d\s]{7,15}$/;

/**
 * "Gombe, Ngaliema et Limete" — at most three commune names, then "et 2
 * autres communes". `more(count)` returns that tail in the reader's language.
 */
export function agentPlaceList(communes, { locale = 'fr', more = (n) => `+${n}`, label = (c) => c, max = 3 } = {}) {
  const names = [...new Set((communes || []).map((c) => label(c)).filter(Boolean))];
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const items = rest > 0 ? [...shown, more(rest)] : shown;
  try {
    return new Intl.ListFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/**
 * The profile's meta description, from facts only (`t` is the page's
 * translator). A name that is only a phone number is never printed ("Une
 * agence" instead). No count line for an agent with no live listing.
 */
export function agentMetaDescription({ name, liveCount, communes, t, locale = 'fr', label }) {
  const realName = name && !PHONE_SHAPED.test(String(name).trim()) ? String(name).trim() : t('agent.portfolio.metaUnnamed');
  const count = Number.isFinite(Number(liveCount)) ? Math.max(0, Math.trunc(Number(liveCount))) : 0;
  if (count === 0) return t('agent.portfolio.metaDescriptionEmpty', { name: realName });
  const place = agentPlaceList(communes, {
    locale,
    label,
    more: (n) => t('agent.portfolio.metaMoreCommunes', { count: n }),
  });
  return place
    ? t('agent.portfolio.metaDescription', { name: realName, count, place })
    : t('agent.portfolio.metaDescriptionNoPlace', { name: realName, count });
}

const isHttps = (value) => typeof value === 'string' && /^https:\/\//.test(value);

/**
 * The profile's share image: the agency's own logo when it has one, else a
 * photo of its newest public listing, else null — the caller then keeps the
 * site's default card. Never a photo from another agent.
 */
export function agentOgImage({ logo = null, listingPhoto = null } = {}) {
  if (isHttps(logo)) return logo;
  if (isHttps(listingPhoto)) return listingPhoto;
  return null;
}

/**
 * Sitemap entries for agent profiles: one per row of getSitemapAgents (an
 * active, non-deleted, non-demo, non-test agent with at least one public live
 * listing). lastModified is that agent's latest listing activity when the
 * row carries a valid date, else none.
 */
export function agentSitemapEntries(rows, base) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const at = row.last_listing_at ? new Date(row.last_listing_at) : null;
    out.push({
      url: `${base}/agents/${id}`,
      ...(at && !Number.isNaN(at.getTime()) ? { lastModified: at } : {}),
      changeFrequency: 'weekly',
      priority: 0.6,
    });
  }
  return out;
}
