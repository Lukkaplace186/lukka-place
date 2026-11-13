// What the app home's card slot shows (components/app/AppPromoCarousel.js).
// Pure, so the feed can change (articles today, partner agencies later)
// without touching the layout, and so it is unit-tested.

/** How many cards the slot carries. */
export const PROMO_MAX = 6;

/**
 * The latest guides and news as slot items: { href, title, kicker, imageUrl }.
 * `labels` are the two kicker words ({ guide, news }). An article without a
 * title or a slug is skipped; one without a cover keeps `imageUrl` null and
 * the card draws no picture (never a stand-in).
 */
export function promoItemsFromArticles(articles, labels = {}) {
  return (Array.isArray(articles) ? articles : [])
    .filter((article) => article && article.slug && article.title)
    .slice(0, PROMO_MAX)
    .map((article) => ({
      href: `/guides/${article.slug}`,
      title: String(article.title),
      kicker: (article.category === 'actualite' ? labels.news : labels.guide) || null,
      imageUrl: typeof article.coverUrl === 'string' && /^https:\/\//.test(article.coverUrl) ? article.coverUrl : null,
    }));
}
