import 'server-only';
import { cache } from 'react';
import { getPool } from './db';
import { GUIDES, getGuide } from './guides';
import { getFeatureFlags } from './siteSettings';
import { articleFromGuide, articleFromPost, mergeArticles } from './blogRules';

/**
 * Guides & Actualités — reads and writes on `blog_posts`
 * (migrations/20261026_blog_posts.sql, engine repo). Rules in lib/blogRules.js.
 *
 * Public reads apply PUBLIC_POST_FILTER and nothing else decides it: a draft,
 * a scheduled post before its time and a deleted post are never returned.
 * Whether the blog is on at all (`publicBlog`, lib/siteSettings.js) is the
 * page's question. Every public read degrades to "no posts" when the table
 * does not exist yet (42P01), so /guides keeps its code guides.
 */

export const PUBLIC_POST_FILTER = "status = 'published' AND published_at <= NOW() AND deleted_at IS NULL";

const POST_COLUMNS = `id, slug, category, status, published_at, title_fr, summary_fr, body_fr, title_en, summary_en, body_en,
  cover_url, cover_alt, purpose, commune, property_type, created_by, updated_by, created_at, updated_at`;

const LIST_COLUMNS = `id, slug, category, status, published_at, title_fr, summary_fr, title_en, summary_en, body_en,
  cover_url, cover_alt, purpose, commune, property_type, updated_at`;

function missingTable(err) {
  return err?.code === '42P01' || err?.code === '42703';
}

/** Published posts, newest first. `[]` before the migration. */
export async function listPublicPosts({ limit = 100 } = {}) {
  try {
    const { rows } = await getPool().query(
      `SELECT ${LIST_COLUMNS}, body_fr FROM blog_posts WHERE ${PUBLIC_POST_FILTER} ORDER BY published_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  } catch (err) {
    if (!missingTable(err)) console.error(`[blog] public posts unavailable: ${err.message}`);
    return [];
  }
}

/** One published post by slug, or null. */
export async function getPublicPost(slug) {
  try {
    const { rows } = await getPool().query(`SELECT ${POST_COLUMNS} FROM blog_posts WHERE slug = $1 AND ${PUBLIC_POST_FILTER}`, [slug]);
    return rows[0] || null;
  } catch (err) {
    if (!missingTable(err)) console.error(`[blog] post ${slug} unavailable: ${err.message}`);
    return null;
  }
}

/** Slugs and dates for the sitemap. */
export async function listPublicPostSlugs() {
  try {
    const { rows } = await getPool().query(`SELECT slug, updated_at FROM blog_posts WHERE ${PUBLIC_POST_FILTER}`);
    return rows;
  } catch (err) {
    if (!missingTable(err)) console.error(`[blog] sitemap slugs unavailable: ${err.message}`);
    return [];
  }
}

// --- Console (/admin/blog). These throw; the pages show the error. ---------

/** Every live post, newest edit first, with an optional search. */
export async function listPostsForAdmin({ q = '', limit = 50, offset = 0 } = {}) {
  const term = String(q || '').trim();
  const params = [];
  let where = 'deleted_at IS NULL';
  if (term) {
    params.push(`%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where += ` AND (title_fr ILIKE $1 OR slug ILIKE $1 OR COALESCE(title_en, '') ILIKE $1)`;
  }
  params.push(limit, offset);
  const { rows } = await getPool().query(
    `SELECT ${LIST_COLUMNS}, COUNT(*) OVER ()::int AS total_count
       FROM blog_posts WHERE ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export async function getPostForAdmin(id) {
  const numeric = Number.parseInt(id, 10);
  if (!Number.isFinite(numeric)) return null;
  const { rows } = await getPool().query(`SELECT ${POST_COLUMNS} FROM blog_posts WHERE id = $1 AND deleted_at IS NULL`, [numeric]);
  return rows[0] || null;
}

/** True when another live post already uses the slug. */
export async function slugTaken(slug, exceptId = null) {
  const { rows } = await getPool().query(
    'SELECT 1 FROM blog_posts WHERE slug = $1 AND deleted_at IS NULL AND ($2::bigint IS NULL OR id <> $2) LIMIT 1',
    [slug, exceptId],
  );
  return rows.length > 0;
}

const WRITE_FIELDS = [
  'slug', 'category', 'status', 'published_at', 'title_fr', 'summary_fr', 'body_fr', 'title_en', 'summary_en', 'body_en',
  'cover_url', 'cover_alt', 'purpose', 'commune', 'property_type',
];

/** @returns {Promise<number>} the new id */
export async function createPost(values, adminId) {
  const params = WRITE_FIELDS.map((f) => values[f] ?? null);
  params.push(adminId);
  const { rows } = await getPool().query(
    `INSERT INTO blog_posts (${WRITE_FIELDS.join(', ')}, created_by, updated_by)
     VALUES (${WRITE_FIELDS.map((_, i) => `$${i + 1}`).join(', ')}, $${params.length}, $${params.length})
     RETURNING id`,
    params,
  );
  return rows[0].id;
}

/** @returns {Promise<boolean>} false when the post is gone */
export async function updatePost(id, values, adminId) {
  const params = WRITE_FIELDS.map((f) => values[f] ?? null);
  params.push(adminId, id);
  const { rowCount } = await getPool().query(
    `UPDATE blog_posts
        SET ${WRITE_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')},
            updated_by = $${params.length - 1}, updated_at = NOW()
      WHERE id = $${params.length} AND deleted_at IS NULL`,
    params,
  );
  return rowCount > 0;
}

/** Back to draft, keeping the date it was first published. */
export async function unpublishPost(id, adminId) {
  const { rowCount } = await getPool().query(
    `UPDATE blog_posts SET status = 'draft', updated_by = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id, adminId],
  );
  return rowCount > 0;
}

/** Soft delete; the slug is free again. */
export async function deletePost(id, adminId) {
  const { rowCount } = await getPool().query(
    `UPDATE blog_posts SET deleted_at = NOW(), updated_by = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id, adminId],
  );
  return rowCount > 0;
}

/**
 * What /guides/<slug> shows, or null (a real 404). With the blog on, a
 * published post wins over a code guide of the same slug; with it off only
 * the code guides exist, exactly as before the blog. One read per request
 * (the layout's 404 check, metadata and the page share it).
 */
export const getPublicArticle = cache(async (slug, locale = 'fr') => {
  const { publicBlog } = await getFeatureFlags();
  if (publicBlog) {
    const post = await getPublicPost(slug);
    if (post) return articleFromPost(post, locale);
  }
  const guide = getGuide(slug);
  return guide ? articleFromGuide(guide) : null;
});

/** The other articles /guides lists, for "À lire aussi". */
export async function listPublicArticles(locale = 'fr') {
  const { publicBlog } = await getFeatureFlags();
  return mergeArticles(GUIDES, publicBlog ? await listPublicPosts() : [], locale);
}
