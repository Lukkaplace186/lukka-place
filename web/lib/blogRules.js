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
 *   | a | b |           a table; :::blocks — see RICH BLOCKS below
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
import { CITIES, cityOfCommune, communeLabel, communesOfCity } from './cities';

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

/**
 * RICH BLOCKS (2026-11-10). Posts are written with Claude and pasted or
 * imported (scripts/blog-import.mjs); the site draws tables, charts, key
 * figures and live market data from these, with its own styling and motion.
 * Still no HTML: every block is data the renderer turns into elements.
 *
 *   | Commune | 2 chambres |      a table (a `|---|` line makes the line
 *   |---|---|                      above it the header row)
 *   | Gombe | 1 200 $ |
 *
 *   :::name clé="valeur" clé=valeur
 *   …lines…
 *   :::
 *
 * Directives (attribute names without accents):
 *   tableau    titre, source — a pipe table inside
 *   chiffres   source — "valeur | libellé" lines, 1 to 4 (key figures)
 *   graphique  type=barres|ligne, titre, unite, source (REQUIRED: a chart
 *              never shows a figure we cannot attribute), series="2025, 2026"
 *              — "libellé | nombre [| nombre…]" lines, at least 2
 *   astuce | attention | info   titre — paragraphs and lists inside
 *   citation   auteur, role — the quoted text inside
 *   prix       communes="Gombe, Ngaliema", chambres=2 — LIVE medians from
 *              the price guide (lib/browseFeatures.js getPriceGuides); one
 *              line, no closing ":::". One commune without chambres = its
 *              1–5 bedroom medians.
 *   annonces   commune, type, transaction=location|vente — LIVE listings
 *              (three cards, the public gate); one line.
 *
 * parseBody never throws: a block it cannot read becomes {invalid}, drawn
 * as nothing in public and as a warning in the console preview, and
 * bodyProblems() lists them so saving or importing refuses the body.
 */
export const DIRECTIVES = ['tableau', 'chiffres', 'graphique', 'astuce', 'attention', 'info', 'citation', 'prix', 'annonces', 'calculateur'];
const ONE_LINE = new Set(['prix', 'annonces', 'calculateur']);
/** `:::calculateur type=…` — the interactive tools an article can embed. */
export const CALCULATORS = ['garantie'];
const CALLOUT_TONES = { astuce: 'tip', attention: 'warning', info: 'info' };
export const BLOCK_LIMITS = { stats: 4, chartPoints: 24, chartSeries: 3, priceCommunes: 8, tableColumns: 8, tableRows: 60 };

/** `clé="a b" x=y` → { clé: 'a b', x: 'y' }. */
export function parseAttributes(text) {
  const attrs = {};
  const pattern = /([a-z_]+)=(?:"([^"]*)"|“([^”]*)”|(\S+))/gi;
  let m;
  while ((m = pattern.exec(String(text || ''))) !== null) attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  return attrs;
}

/** "1 200 $" → 1200, "2,5" → 2.5, "-3 %" → -3; null when there is no number. */
export function parseFigure(text) {
  const cleaned = String(text ?? '').replace(/[\s  ]/g, '').replace(/[^0-9,.\-]/g, '').replace(',', '.');
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

const isSeparatorRow = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line);

/** Pipe lines → {head, rows} (cells parsed for links), or {error}. */
function parseTableLines(lines) {
  const rows = [];
  let head = null;
  lines.forEach((line, i) => {
    if (isSeparatorRow(line)) {
      if (i === 1 && rows.length === 1) head = rows.pop();
      return;
    }
    rows.push(splitRow(line));
  });
  if (!rows.length) return { error: 'tableau vide' };
  const width = Math.max(head ? head.length : 0, ...rows.map((r) => r.length));
  if (width > BLOCK_LIMITS.tableColumns) return { error: `tableau de plus de ${BLOCK_LIMITS.tableColumns} colonnes` };
  if (rows.length > BLOCK_LIMITS.tableRows) return { error: `tableau de plus de ${BLOCK_LIMITS.tableRows} lignes` };
  const pad = (r) => [...r, ...Array(width - r.length).fill('')].map((cell) => (cell ? parseInline(cell) : ''));
  return { head: head ? pad(head) : null, rows: rows.map(pad) };
}

function foldName(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
let communeIndex = null;
/** "gombe" → "Gombe" (the key cities.json and the price guide use), or null. */
export function canonicalCommune(name) {
  if (!communeIndex) {
    communeIndex = new Map();
    for (const city of CITIES) {
      for (const key of communesOfCity(city.name)) {
        communeIndex.set(foldName(key), key);
        if (!communeIndex.has(foldName(communeLabel(key)))) communeIndex.set(foldName(communeLabel(key)), key);
      }
    }
  }
  return communeIndex.get(foldName(name)) || null;
}

const invalid = (name, reason) => ({ invalid: { name, reason } });

/** One directive (name, attributes, inner lines) → a block. */
function directiveBlock(name, attrs, inner) {
  const source = attrs.source || null;
  const title = attrs.titre || null;
  const content = inner.filter((l) => l.trim());
  switch (name) {
    case 'tableau': {
      const pipe = content.map((l) => l.trim());
      if (pipe.some((l) => !l.startsWith('|'))) return invalid(name, 'chaque ligne d’un tableau commence par « | »');
      const table = parseTableLines(pipe);
      if (table.error) return invalid(name, table.error);
      return { table: { ...table, title, source } };
    }
    case 'chiffres': {
      const items = content.map((l) => splitRow(l.trim()));
      if (!items.length || items.length > BLOCK_LIMITS.stats) return invalid(name, `entre 1 et ${BLOCK_LIMITS.stats} chiffres`);
      if (items.some((cells) => cells.length < 2 || !cells[0] || !cells[1])) return invalid(name, 'chaque ligne est « valeur | libellé »');
      return { stats: { items: items.map(([value, ...rest]) => ({ value, label: rest.join(' | ') })), source } };
    }
    case 'graphique': {
      const kind = { barres: 'bar', ligne: 'line' }[(attrs.type || 'barres').toLowerCase()];
      if (!kind) return invalid(name, 'type=barres ou type=ligne');
      if (!source) return invalid(name, 'un graphique a toujours une source (source="…")');
      const points = [];
      for (const line of content) {
        const [label, ...cells] = splitRow(line.trim());
        const values = cells.map(parseFigure);
        if (!label || !values.length || values.some((v) => v === null)) {
          return invalid(name, `ligne illisible « ${line.trim()} » (attendu « libellé | nombre »)`);
        }
        points.push({ label, values });
      }
      if (points.length < 2) return invalid(name, 'au moins 2 lignes');
      if (points.length > BLOCK_LIMITS.chartPoints) return invalid(name, `au plus ${BLOCK_LIMITS.chartPoints} lignes`);
      const width = points[0].values.length;
      if (width > BLOCK_LIMITS.chartSeries || points.some((p) => p.values.length !== width)) {
        return invalid(name, `le même nombre de valeurs sur chaque ligne (au plus ${BLOCK_LIMITS.chartSeries})`);
      }
      const series = attrs.series ? attrs.series.split(',').map((s) => s.trim()).filter(Boolean) : [];
      if (series.length && series.length !== width) return invalid(name, `series= nomme ${series.length} séries pour ${width} valeurs par ligne`);
      if (width > 1 && !series.length) return invalid(name, 'plusieurs valeurs par ligne : nommer les séries (series="2025, 2026")');
      return { chart: { kind, title, unit: attrs.unite || '', source, series, points } };
    }
    case 'astuce':
    case 'attention':
    case 'info': {
      const blocks = parseBody(inner.join('\n'), { nested: true });
      if (!blocks.length) return invalid(name, 'encadré vide');
      return { callout: { tone: CALLOUT_TONES[name], title, blocks } };
    }
    case 'citation': {
      if (!content.length) return invalid(name, 'citation vide');
      return { quote: { text: parseInline(content.map((l) => l.trim()).join(' ')), author: attrs.auteur || null, role: attrs.role || null } };
    }
    case 'prix': {
      const names = String(attrs.communes || attrs.commune || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!names.length) return invalid(name, 'communes="Gombe, Ngaliema"');
      if (names.length > BLOCK_LIMITS.priceCommunes) return invalid(name, `au plus ${BLOCK_LIMITS.priceCommunes} communes`);
      const communes = names.map(canonicalCommune);
      const unknown = names.filter((_, i) => !communes[i]);
      if (unknown.length) return invalid(name, `commune inconnue : ${unknown.join(', ')}`);
      let beds = null;
      if (attrs.chambres) {
        beds = Number.parseInt(attrs.chambres, 10);
        if (!(beds >= 1 && beds <= 5)) return invalid(name, 'chambres=1 à 5');
      }
      if (communes.length > 1 && !beds) return invalid(name, 'plusieurs communes : préciser chambres=');
      return { prices: { communes, beds } };
    }
    case 'annonces': {
      const commune = attrs.commune ? canonicalCommune(attrs.commune) : null;
      if (attrs.commune && !commune) return invalid(name, `commune inconnue : ${attrs.commune}`);
      const wanted = attrs.type ? attrs.type.toLowerCase() : null;
      const propertyType = wanted ? (BLOG_PROPERTY_TYPES.find((t) => t.value === wanted)?.value ?? null) : null;
      if (wanted && !propertyType) return invalid(name, `type inconnu : ${attrs.type} (${BLOG_PROPERTY_TYPES.map((t) => t.value).join(', ')})`);
      const transaction = attrs.transaction ? attrs.transaction.toLowerCase() : 'location';
      if (!['location', 'vente'].includes(transaction)) return invalid(name, 'transaction=location ou vente');
      return { listings: { commune, propertyType, transaction } };
    }
    case 'calculateur': {
      const kind = (attrs.type || 'garantie').toLowerCase();
      if (!CALCULATORS.includes(kind)) return invalid(name, `type=${CALCULATORS.join(' ou ')}`);
      return { calculator: { kind } };
    }
    default:
      return invalid(name, 'bloc inconnu');
  }
}

/** The body text → blocks. `nested` (inside a callout): no directives or tables. */
export function parseBody(text, { nested = false } = {}) {
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
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      flush();
      continue;
    }
    const directive = nested ? null : line.match(/^:::\s*([a-z]+)\b(.*)$/i);
    if (directive) {
      flush();
      const name = directive[1].toLowerCase();
      const attrs = parseAttributes(directive[2]);
      if (ONE_LINE.has(name)) {
        // A closing line written out of habit right after a one-line block is tolerated.
        if (lines[i + 1]?.trim() === ':::') i += 1;
        blocks.push(directiveBlock(name, attrs, []));
        continue;
      }
      const inner = [];
      let closed = false;
      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trim() === ':::') {
          closed = true;
          break;
        }
        inner.push(lines[i]);
      }
      if (!DIRECTIVES.includes(name)) blocks.push(invalid(name, 'bloc inconnu'));
      else if (!closed) blocks.push(invalid(name, 'jamais fermé (ligne « ::: » manquante)'));
      else blocks.push(directiveBlock(name, attrs, inner));
      continue;
    }
    if (!nested && line.startsWith('|')) {
      flush();
      const pipe = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        pipe.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      const table = parseTableLines(pipe);
      blocks.push(table.error ? invalid('tableau', table.error) : { table: { ...table, title: null, source: null } });
      continue;
    }
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    const numbered = line.match(/^\d{1,2}[.)]\s+(.+)$/);
    if (heading) {
      flush();
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
  flush();
  return blocks;
}

/** What is wrong with a body's blocks, as French sentences for the console ([] = fine). */
export function bodyProblems(text) {
  const problems = [];
  const walk = (blocks) => {
    for (const b of blocks) {
      if (b.invalid) problems.push(`:::${b.invalid.name} — ${b.invalid.reason}`);
      if (b.callout) walk(b.callout.blocks);
    }
  };
  walk(parseBody(text));
  return problems;
}

/** Plain text of a block's content (for a reading-time estimate). */
function blockText(value) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' ? v : v.text || blockText(v))).join(' ');
  return String(value || '');
}

/** The words a reader reads in one block. */
function wordsOf(b) {
  if (b.table) return blockText([...(b.table.head || []), ...b.table.rows].flat());
  if (b.stats) return b.stats.items.map((it) => `${it.value} ${it.label}`).join(' ');
  if (b.chart) return [b.chart.title, ...b.chart.points.map((pt) => pt.label)].join(' ');
  if (b.callout) return [b.callout.title, ...b.callout.blocks.map(wordsOf)].join(' ');
  if (b.quote) return blockText(b.quote.text);
  if (b.calculator || b.prices || b.listings) return '';
  return blockText(b.h2 || b.p || b.ul || b.ol);
}

/** Minutes to read at 200 words a minute, at least 1. */
export function readingMinutes(blocks) {
  const words = (blocks || [])
    .map(wordsOf)
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
 * @returns {{ok: true, values: object} | {ok: false, error: string, field: string, detail?: string}}
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
  for (const [body, field] of [[bodyFr, 'body_fr'], [bodyEn, 'body_en']]) {
    const problems = body ? bodyProblems(body) : [];
    // `detail` names each block in French; the console shows it after the message.
    if (problems.length) return { ok: false, error: 'badBlock', field, detail: problems.join(' · ') };
  }

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

/**
 * A lib/guides.js guide → the same shape, in English for an English reader
 * when the guide carries an `en` version (all-or-nothing, like a post).
 */
export function articleFromGuide(guide, locale = 'fr') {
  const en = locale === 'en' && guide.en?.title && guide.en?.body ? guide.en : null;
  return {
    source: 'code',
    id: null,
    slug: guide.slug,
    category: 'guide',
    lang: en ? 'en' : 'fr',
    title: en ? en.title : guide.title,
    summary: en ? en.description : guide.description,
    blocks: en ? en.body : guide.body,
    coverUrl: null,
    coverAlt: '',
    publishedAt: new Date(`${guide.published}T08:00:00+01:00`).toISOString(),
    updatedAt: new Date(`${guide.updated}T08:00:00+01:00`).toISOString(),
    listings: null,
    cta: (en && en.cta) || guide.cta,
  };
}

/**
 * The /guides list: the code guides, with a post of the same slug replacing
 * its guide, newest first. Posts are only passed in when the blog is on.
 */
export function mergeArticles(guides, posts, locale = 'fr') {
  const bySlug = new Map(guides.map((g) => [g.slug, articleFromGuide(g, locale)]));
  for (const post of posts) bySlug.set(post.slug, articleFromPost(post, locale));
  return [...bySlug.values()].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

/** ?categorie= on /guides: 'guide' | 'actualite' | null (all). */
export function parseCategory(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return BLOG_CATEGORIES.includes(v) ? v : null;
}
