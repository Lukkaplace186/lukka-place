'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { createPost, deletePost, getPostForAdmin, slugTaken, unpublishPost, updatePost } from '@/lib/blog';
import { validatePostInput } from '@/lib/blogRules';
import { uploadCmsImage } from '@/lib/listingStorage';
import { getT } from '@/lib/i18n/server';

const COVER_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const COVER_MAX_BYTES = 10 * 1024 * 1024;

const FIELDS = [
  'slug', 'category', 'status', 'published_at', 'title_fr', 'summary_fr', 'body_fr', 'title_en', 'summary_en', 'body_en',
  'cover_alt', 'purpose', 'commune', 'property_type',
];

function revalidatePublic(slugs) {
  revalidatePath('/admin/blog');
  revalidatePath('/guides');
  for (const slug of slugs) if (slug) revalidatePath(`/guides/${slug}`);
}

/**
 * The cover: a new upload (resized to 1600 px JPEG, stored under cms/blog/ in
 * the listing bucket), the post's current one, or none. A URL typed into the
 * form is never trusted — only what this action uploaded or the row holds.
 */
async function resolveCover(formData, existing, t) {
  if (formData.get('remove_cover') === 'on') return { url: null };
  const file = formData.get('cover');
  if (file && typeof file !== 'string' && file.size > 0) {
    const ext = COVER_TYPES[file.type];
    if (!ext) return { error: t('admin.blog.errors.coverType') };
    if (file.size > COVER_MAX_BYTES) return { error: t('admin.blog.errors.coverSize', { max: 10 }) };
    let buffer = Buffer.from(await file.arrayBuffer());
    let finalExt = ext;
    try {
      const { default: sharp } = await import('sharp');
      buffer = await sharp(buffer).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      finalExt = 'jpg';
    } catch (err) {
      console.error(`[blog] cover resize skipped, uploading the original: ${err.message}`);
    }
    return { url: await uploadCmsImage(buffer, finalExt, 'blog') };
  }
  return { url: existing?.cover_url || null };
}

/**
 * Create (no `id`) or update a post. Drafts and published posts go through
 * the same validation; "Publier" with no date publishes now, a future date
 * schedules it. Nothing appears on /guides while `publicBlog` is off.
 * @returns {Promise<{ok: false, error: string, field?: string} | {ok: true, message: string}>}
 */
export async function savePostAction(_previous, formData) {
  const t = await getT();
  let createdId = null;
  try {
    const session = await requireAdmin('blog.manage');
    const id = Number.parseInt(formData.get('id'), 10);
    const existing = Number.isFinite(id) ? await getPostForAdmin(id) : null;
    if (Number.isFinite(id) && !existing) return { ok: false, error: t('admin.blog.errors.gone') };

    const input = Object.fromEntries(FIELDS.map((f) => [f, formData.get(f)]));
    const cover = await resolveCover(formData, existing, t);
    if (cover.error) return { ok: false, error: cover.error, field: 'cover' };
    input.cover_url = cover.url;

    const check = validatePostInput(input);
    if (!check.ok) return { ok: false, error: t(`admin.blog.errors.${check.error}`), field: check.field };
    const values = check.values;
    if (await slugTaken(values.slug, existing?.id ?? null)) return { ok: false, error: t('admin.blog.errors.slugTaken'), field: 'slug' };

    const adminId = session.id ?? null;
    if (existing) {
      if (!(await updatePost(existing.id, values, adminId))) return { ok: false, error: t('admin.blog.errors.gone') };
    } else {
      createdId = await createPost(values, adminId);
    }
    await recordAudit(session, {
      action: existing ? 'blog.update' : 'blog.create',
      entityType: 'blog_post',
      entityId: String(existing?.id ?? createdId),
      details: { slug: values.slug, status: values.status, publishedAt: values.published_at, category: values.category, bodyLength: values.body_fr.length },
    });
    revalidatePublic([values.slug, existing?.slug]);
    if (existing) return { ok: true, message: t('admin.blog.saved') };
  } catch (err) {
    if (err?.code === '42P01') return { ok: false, error: t('admin.blog.missingTable') };
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
  // Outside the try: redirect() throws by design.
  redirect(`/admin/blog/${createdId}?created=1`);
}

export async function unpublishPostAction(formData) {
  const session = await requireAdmin('blog.manage');
  const id = Number.parseInt(formData.get('id'), 10);
  const post = await getPostForAdmin(id);
  if (post && (await unpublishPost(id, session.id ?? null))) {
    await recordAudit(session, { action: 'blog.unpublish', entityType: 'blog_post', entityId: String(id), details: { slug: post.slug } });
    revalidatePublic([post.slug]);
  }
  redirect(`/admin/blog/${id}?unpublished=1`);
}

export async function deletePostAction(formData) {
  const session = await requireAdmin('blog.manage');
  const id = Number.parseInt(formData.get('id'), 10);
  const post = await getPostForAdmin(id);
  if (post && (await deletePost(id, session.id ?? null))) {
    await recordAudit(session, { action: 'blog.delete', entityType: 'blog_post', entityId: String(id), details: { slug: post.slug } });
    revalidatePublic([post.slug]);
  }
  redirect('/admin/blog?deleted=1');
}
