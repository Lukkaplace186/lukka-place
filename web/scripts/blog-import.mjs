#!/usr/bin/env node
/**
 * Puts an article written with Claude into /admin/blog — as a DRAFT the team
 * previews (/admin/blog/<id>/apercu) and publishes from the console. The
 * console stays the only place a post goes public.
 *
 *   npm run blog:import -- articles/loyers-gombe-2026.md            (dry run)
 *   npm run blog:import -- articles/loyers-gombe-2026.md --write
 *   npm run blog:import -- articles/loyers-gombe-2026.md --cover-only [--write]
 *     (only the cover and its alt text of an existing post; the text, live or
 *      not, is left alone)
 *
 * THE FILE. A header between two `---` lines, then the French body in the
 * post format (lib/blogRules.js: ## titres, listes, liens, tableaux, :::blocs).
 * An optional English version follows a line `=== english ===`.
 *
 *   ---
 *   titre: Combien coûte un appartement à Gombe en 2026 ?
 *   resume: Les loyers demandés, commune par commune, et ce qu'ils couvrent.
 *   categorie: guide                  (guide | actualite)
 *   slug: loyer-appartement-gombe-2026 (optional: from the title)
 *   commune: Gombe                    (optional — the "voir les biens" link)
 *   type: appartement                 (optional)
 *   transaction: location             (optional: location | vente)
 *   couverture: images/gombe.jpg      (optional: a local photo, uploaded)
 *   couverture_alt: Immeubles du boulevard du 30 Juin
 *   titre_en: …   resume_en: …        (with the English body)
 *   ---
 *
 * The same validation as the console's Save button (validatePostInput,
 * bodyProblems): an unreadable block, a chart without a source or an
 * unknown commune stops the import and says which.
 *
 * Re-importing the same slug UPDATES that post's text and keeps its state:
 * a published post stays published with the new text (the script says so
 * before writing). The cover is replaced only when the file names one.
 *
 * Reads DB_* and SUPABASE_* from .env.local (tests/support/register.mjs) —
 * the production database. Every write is audited as `script:blog-import`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPool } from '@/lib/db';
import { createPost, updatePost } from '@/lib/blog';
import { bodyProblems, parseBody, postState, readingMinutes, validatePostInput } from '@/lib/blogRules';

const HEADER_KEYS = {
  titre: 'title_fr',
  resume: 'summary_fr',
  categorie: 'category',
  slug: 'slug',
  commune: 'commune',
  type: 'property_type',
  transaction: 'purpose',
  titre_en: 'title_en',
  resume_en: 'summary_en',
  couverture: 'cover_file',
  couverture_alt: 'cover_alt',
};

/** The file's text → { fields, body_fr, body_en }, or throws with a French message. */
export function parseArticleFile(text) {
  const normalized = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('le fichier doit commencer par un en-tête entre deux lignes « --- »');
  const fields = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([a-z_]+)\s*:\s*(.*)$/i);
    if (!kv) throw new Error(`ligne d’en-tête illisible : « ${line} »`);
    const key = HEADER_KEYS[kv[1].toLowerCase()];
    if (!key) throw new Error(`clé d’en-tête inconnue : ${kv[1]} (${Object.keys(HEADER_KEYS).join(', ')})`);
    fields[key] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  const [fr, en = ''] = m[2].split(/^===\s*english\s*===\s*$/im);
  return { fields, body_fr: fr.trim(), body_en: en.trim() };
}

const COVER_MAX_WIDTH = 3840;

async function uploadCover(file) {
  const { uploadCmsImage } = await import('@/lib/listingStorage');
  let buffer = fs.readFileSync(file);
  let ext = path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg');
  if (!['jpg', 'png', 'webp'].includes(ext)) throw new Error(`couverture : JPEG, PNG ou WebP seulement (${file})`);
  try {
    const { default: sharp } = await import('sharp');
    // Up to 4K: next/image serves each reader a resized copy, so the stored
    // original only sets the ceiling. A JPEG already within it goes up as made
    // (a re-encode would only lose detail on a drawn cover).
    const meta = await sharp(buffer).metadata();
    if (!(ext === 'jpg' && meta.width <= COVER_MAX_WIDTH && !(meta.orientation > 1))) {
      buffer = await sharp(buffer)
        .rotate()
        .resize({ width: COVER_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
        .toBuffer();
      ext = 'jpg';
    }
  } catch (err) {
    console.warn(`couverture non redimensionnée (${err.message}) — envoi de l’original`);
  }
  return uploadCmsImage(buffer, ext, 'blog');
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const coverOnly = args.includes('--cover-only');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: npm run blog:import -- <article.md> [--write]');
    process.exit(2);
  }
  const { fields, body_fr: bodyFr, body_en: bodyEn } = parseArticleFile(fs.readFileSync(file, 'utf8'));

  const problems = [...bodyProblems(bodyFr), ...bodyProblems(bodyEn).map((p) => `[EN] ${p}`)];
  if (problems.length) {
    console.error(`Blocs illisibles — rien n’a été écrit :\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }

  const pool = getPool();
  // A first pass only to learn the slug (an existing post keeps its state and cover).
  const first = validatePostInput({ ...fields, body_fr: bodyFr, body_en: bodyEn, status: 'draft', cover_url: null });
  if (!first.ok) {
    console.error(`Refusé : ${first.error}${first.detail ? ` — ${first.detail}` : ''} (champ ${first.field})`);
    process.exit(1);
  }
  const slug = first.values.slug;
  const { rows } = await pool.query(
    'SELECT id, slug, status, published_at, cover_url, cover_alt FROM blog_posts WHERE slug = $1 AND deleted_at IS NULL',
    [slug],
  );
  const existing = rows[0] || null;

  if (fields.cover_file && !fs.existsSync(path.resolve(path.dirname(file), fields.cover_file))) {
    console.error(`couverture introuvable : ${fields.cover_file}`);
    process.exit(1);
  }
  const coverFile = fields.cover_file ? path.resolve(path.dirname(file), fields.cover_file) : null;

  if (coverOnly) {
    if (!existing || !coverFile) {
      console.error(!existing ? `--cover-only : aucun article « ${slug} » à mettre à jour` : '--cover-only : le fichier ne nomme pas de couverture');
      process.exit(1);
    }
    console.log(`Couverture du n° ${existing.id} (${slug}, ${postState(existing)}) : ${path.basename(coverFile)}`);
    console.log(`  avant : ${existing.cover_url || 'aucune'}`);
    console.log(`  texte alternatif : ${fields.cover_alt || '(vide)'}`);
    console.log('  Le texte de l’article n’est pas touché.');
    if (!write) {
      console.log('\nEssai seulement. Relancer avec --write pour écrire.');
      await pool.end();
      return;
    }
    const coverUrl = await uploadCover(coverFile);
    await pool.query(
      'UPDATE blog_posts SET cover_url = $1, cover_alt = $2, updated_at = NOW() WHERE id = $3 AND deleted_at IS NULL',
      [coverUrl, fields.cover_alt || '', existing.id],
    );
    await pool.query(
      `INSERT INTO console_admin_audit_log (admin_user_id, actor_label, action, entity_type, entity_id, details)
       VALUES (NULL, 'script:blog-import', 'blog.cover', 'blog_post', $1, $2)`,
      [String(existing.id), JSON.stringify({ slug, from: existing.cover_url || null, to: coverUrl })],
    );
    console.log(`\nÉcrit : ${coverUrl}`);
    await pool.end();
    return;
  }
  const input = {
    ...fields,
    body_fr: bodyFr,
    body_en: bodyEn,
    status: existing ? existing.status : 'draft',
    published_at: existing?.published_at ? new Date(existing.published_at).toISOString() : '',
    cover_url: coverFile ? 'https://pending.upload/cover.jpg' : existing?.cover_url || null,
    cover_alt: fields.cover_alt || (coverFile ? '' : existing?.cover_alt || ''),
  };
  const check = validatePostInput(input);
  if (!check.ok) {
    console.error(`Refusé : ${check.error}${check.detail ? ` — ${check.detail}` : ''} (champ ${check.field})`);
    process.exit(1);
  }

  const blocks = parseBody(bodyFr);
  const kinds = blocks.map((b) => Object.keys(b)[0]).reduce((acc, k) => ({ ...acc, [k]: (acc[k] || 0) + 1 }), {});
  const state = existing ? postState(existing) : 'draft';
  console.log(`${existing ? `Mise à jour du n° ${existing.id}` : 'Nouvel article (brouillon)'} : ${check.values.title_fr}`);
  console.log(`  slug ${check.values.slug} · ${check.values.category} · ${readingMinutes(blocks)} min · blocs ${JSON.stringify(kinds)}`);
  console.log(`  anglais : ${check.values.title_en ? 'oui' : 'non'} · couverture : ${coverFile ? path.basename(coverFile) : check.values.cover_url ? 'gardée' : 'aucune'}`);
  if (state === 'published') console.log('  ATTENTION : cet article est EN LIGNE — le nouveau texte sera public dès l’écriture.');
  if (!write) {
    console.log('\nEssai seulement. Relancer avec --write pour écrire.');
    await pool.end();
    return;
  }

  const values = { ...check.values };
  if (coverFile) values.cover_url = await uploadCover(coverFile);
  let id = existing?.id;
  if (existing) await updatePost(existing.id, values, null);
  else id = await createPost(values, null);
  await pool.query(
    `INSERT INTO console_admin_audit_log (admin_user_id, actor_label, action, entity_type, entity_id, details)
     VALUES (NULL, 'script:blog-import', $1, 'blog_post', $2, $3)`,
    [existing ? 'blog.update' : 'blog.create', String(id), JSON.stringify({ slug: values.slug, status: values.status, category: values.category, bodyLength: values.body_fr.length })],
  );
  console.log(`\nÉcrit. Aperçu : https://lukkaplace.com/admin/blog/${id}/apercu — publier depuis /admin/blog/${id}`);
  await pool.end();
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]).replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error(err.code === '42P01' ? 'La table blog_posts n’existe pas (migration 20261026_blog_posts.sql).' : err.message);
    process.exit(1);
  });
}
