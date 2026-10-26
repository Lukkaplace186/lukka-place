/**
 * Guides & Actualités — the pure half: validation, the body text format, and
 * how a post (or one of the code guides in lib/guides.js) becomes what a page
 * renders. SQL is in lib/blog.js. Tests: tests/unit/blog.test.js.
 *
 * THE BODY FORMAT. Posts are typed in a plain textarea, never HTML, so
 * nothing a writer pastes can inject markup. One block per paragraph
 * (separated by a blank line):
 *
 *   ## Titre de section
 *   - un point          (consecutive lines: one bulleted list)
 *   1. une étape        (consecutive lines: one numbered list)
 *   anything else       (a paragraph; single line breaks join with a space)
 *
 * Inside any line, [texte](/location/appartements/gombe) is a link: a site
 * path or an https URL. Anything else in brackets stays text.
 *
 * It parses to the same blocks lib/guides.js holds ({h2}|{p}|{ul}|{ol}), so
 * one renderer serves both; a block's text is a string or an array of
 * segments ({text} | {text, href}).
 */
import { seoPath, listingsHrefFor, SEO_PROPERTY_TYPES } from './seoPages';
import { cityOfCommune } from './cities';

export const BLOG_CATEGORIES = ['guide', 'actualite'];
export const BLOG_STATUSES = ['draft', 'published'];
export const BLOG_PURPOSES = ['location', 'vente'];

/** The property types a post can be about: the landing pages' own list. */
export const BLOG_PROPERTY_TYPES = Object.values(SEO_PROPERTY_TYPES).map((t) => ({ value: t.propertyType, labelKey: t.pluralKey }));

export const LIMITS = { title: 200, summary: 400, body: 60000, slug: 120, alt: 200 };

/** Lower-case ASCII words joined by hyphens: "Louer à Gombe !" → "louer-a-gombe". */
export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
}

export function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= LIMITS.slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

/** A link target a post may carry: a site path or an https URL. */
export function safeHref(href) {
  const value = String(href || '').trim();
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** One line of text → segments, with [text](href) links kept only when safe. */
export function parseInline(line) {
  const segments = [];
  const pattern = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    const href = safeHref(match[2]);
    if (!href) continue;
    if (match.index > last) segments.push({ text: line.slice(last, match.index) });
    segments.push({ text: match[1], href });
    last = match.index + match[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last) });
  // A plain line stays a plain string, like the code guides.
  if (segments.length === 1 && !segments[0].href) return segments[0].text;
  return segments;
}

/** The body text → blocks. */
export function parseBody(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ p: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ [list.kind]: list.items.map(parseInline) });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const numbered = line.match(/^\d{1,2}[.)]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ h2: heading[1].trim() });
    } else if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (list && list.kind !== kind) flushList();
      if (!list) list = { kind, items: [] };
      list.items.push((bullet || numbered)[1].trim());
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Plain text of a block's content (for a reading-time estimate). */
function blockText(value) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : v.text || blockText(v))).join(' ');
  return String(value || '');
}

/** Minutes to read at 200 words a minute, at least 1. */
export function readingMinutes(blocks) {
  const words = (blocks || [])
    .map((b) => blockText(b.h2 || b.p || b.ul || b.ol))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function text(value, max) {
  const s = String(value ?? '').trim();
  return s.length > max ? null : s;
}

/**
 * The editor's form → a row's values, or the first error as an i18n key
 * under admin.blog.errors.
 *
 * `publishedAt` is an ISO string or a datetime-local value read as Kinshasa
 * time (UTC+1). Publishing with no date publishes now (`now` is passed in).
 *
 * @returns {{ok: true, values: object} | {ok: false, error: string, field: string}}
 */
export function validatePostInput(input, { now = new Date() } = {}) {
  const titleFr = text(input.title_fr, LIMITS.title);
  if (!titleFr) return { ok: false, error: titleFr === null ? 'titleTooLong' : 'titleRequired', field: 'title_fr' };
  const summaryFr = text(input.summary_fr, LIMITS.summary);
  if (summaryFr === null) return { ok: false, error: 'summaryTooLong', field: 'summary_fr' };
  const bodyFr = text(input.body_fr, LIMITS.body);
  if (bodyFr === null) return { ok: false, error: 'bodyTooLong', field: 'body_fr' };

  const titleEn = text(input.title_en, LIMITS.title);
  const summaryEn = text(input.summary_en, LIMITS.summary);
  const bodyEn = text(input.body_en, LIMITS.body);
  if (titleEn === null || summaryEn === null || bodyEn === null) return { ok: false, error: 'englishTooLong', field: 'title_en' };
  // An English version is all or nothing: a half-translated page reads worse
  // than the French one.
  if ((titleEn || bodyEn) && !(titleEn && bodyEn)) return { ok: false, error: 'englishIncomplete', field: 'title_en' };

  const slug = String(input.slug || '').trim() || slugify(titleFr);
  if (!isValidSlug(slug)) return { ok: false, error: 'badSlug', field: 'slug' };

  const category = BLOG_CATEGORIES.includes(input.category) ? input.category : null;
  if (!category) return { ok: false, error: 'badCategory', field: 'category' };
  const status = BLOG_STATUSES.includes(input.status) ? input.status : 'draft';

  let publishedAt = null;
  const rawDate = String(input.published_at || '').trim();
  if (rawDate) {
    // datetime-local has no zone: it is Kinshasa time.
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawDate) ? `${rawDate}:00+01:00` : rawDate;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return { ok: false, error: 'badDate', field: 'published_at' };
    publishedAt = date.toISOString();
  }
  if (status === 'published' && !publishedAt) publishedAt = now.toISOString();
  if (status === 'published' && !bodyFr) return { ok: false, error: 'bodyRequired', field: 'body_fr' };

  const coverUrl = String(input.cover_url || '').trim() || null;
  if (coverUrl && !/^https:\/\//.test(coverUrl)) return { ok: false, error: 'badCover', field: 'cover_url' };
  const coverAlt = text(input.cover_alt, LIMITS.alt);
  if (coverAlt === null) return { ok: false, error: 'altTooLong', field: 'cover_alt' };
  if (coverUrl && !coverAlt) return { ok: false, error: 'altRequired', field: 'cover_alt' };

  const purpose = BLOG_PURPOSES.includes(input.purpose) ? input.purpose : null;
  const commune = String(input.commune || '').trim() || null;
  if (commune && !cityOfCommune(commune)) return { ok: false, error: 'badCommune', field: 'commune' };
  const propertyType = String(input.property_type || '').trim() || null;
  if (propertyType && !BLOG_PROPERTY_TYPES.some((t) => t.value === propertyType)) return { ok: false, error: 'badType', field: 'property_type' };

  return {
    ok: true,
    values: {
      slug,
      category,
      status,
      published_at: publishedAt,
      title_fr: titleFr,
      summary_fr: summaryFr,
      body_fr: bodyFr,
      title_en: titleEn || null,
      summary_en: summaryEn || null,
      body_en: bodyEn || null,
      cover_url: coverUrl,
      cover_alt: coverUrl ? coverAlt : null,
      purpose,
      commune,
      property_type: propertyType,
    },
  };
}

/** draft | scheduled | published — what the console shows. */
export function postState(row, now = new Date()) {
  if (!row || row.status !== 'published' || !row.published_at) return 'draft';
  return new Date(row.published_at) > now ? 'scheduled' : 'published';
}

/** Where a post's "voir les biens" link goes, or null when it names nothing. */
export function postListingsHref({ purpose, commune, property_type: propertyType }) {
  if (!purpose && !commune && !propertyType) return null;
  const transaction = purpose || 'location';
  return (
    seoPath({ transaction, propertyType, commune }) ||
    listingsHrefFor({ transactionType: transaction, propertyType, commune, ville: commune ? cityOfCommune(commune) : null })
  );
}

/**
 * A row → the article a page renders, in the reader's language when an
 * English version exists. `lang` says which one was used.
 */
export function articleFromPost(row, locale = 'fr') {
  const english = locale === 'en' && row.title_en && row.body_en;
  const publishedAt = row.published_at ? new Date(row.published_at).toISOString() : null;
  return {
    source: 'post',
    id: row.id,
    slug: row.slug,
    category: row.category,
    lang: english ? 'en' : 'fr',
    title: english ? row.title_en : row.title_fr,
    summary: (english ? row.summary_en : row.summary_fr) || '',
    blocks: parseBody(english ? row.body_en : row.body_fr),
    coverUrl: row.cover_url || null,
    coverAlt: row.cover_alt || '',
    publishedAt,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : publishedAt,
    listings: { purpose: row.purpose || null, commune: row.commune || null, propertyType: row.property_type || null },
    cta: null,
  };
}

/** A lib/guides.js guide → the same shape. Always French. */
export function articleFromGuide(guide) {
  return {
    source: 'code',
    id: null,
    slug: guide.slug,
    category: 'guide',
    lang: 'fr',
    title: guide.title,
    summary: guide.description,
    blocks: guide.body,
    coverUrl: null,
    coverAlt: '',
    publishedAt: new Date(`${guide.published}T08:00:00+01:00`).toISOString(),
    updatedAt: new Date(`${guide.updated}T08:00:00+01:00`).toISOString(),
    listings: null,
    cta: guide.cta,
  };
}

/**
 * The /guides list: the code guides, with a post of the same slug replacing
 * its guide, newest first. Posts are only passed in when the blog is on.
 */
export function mergeArticles(guides, posts, locale = 'fr') {
  const bySlug = new Map(guides.map((g) => [g.slug, articleFromGuide(g)]));
  for (const post of posts) bySlug.set(post.slug, articleFromPost(post, locale));
  return [...bySlug.values()].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** ?categorie= on /guides: 'guide' | 'actualite' | null (all). */
export function parseCategory(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return BLOG_CATEGORIES.includes(v) ? v : null;
}
