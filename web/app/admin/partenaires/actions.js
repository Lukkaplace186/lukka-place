'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { parsePartnerForm } from '@/lib/partnerRules';
import { PartnerInputError, createPartner, setPartnerStatus, updatePartner, upsertSocialStats } from '@/lib/partnersAdmin';
import { weekStart as mondayOf } from '@/lib/growthRules';

const PATH = '/admin/partenaires';

function withFlash(path, flash) {
  const url = new URL(path, 'http://console.local');
  url.searchParams.set('flash', flash);
  return `${url.pathname}${url.search}`;
}

/**
 * A creator or a campaign code (agents get theirs automatically). Owner only
 * (partners.manage). The code typed is kept; empty, one is made from the name.
 */
export async function createPartnerAction(formData) {
  const session = await requireAdmin('partners.manage');
  let input;
  try {
    input = parsePartnerForm(Object.fromEntries(formData), { creating: true });
  } catch (err) {
    redirect(withFlash(`${PATH}?new=1`, `invalid_${err.message}`));
  }

  let created;
  try {
    created = await createPartner(input);
  } catch (err) {
    if (err instanceof PartnerInputError) redirect(withFlash(`${PATH}?new=1`, err.code));
    console.error(`[admin/partenaires] create failed: ${err.message}`);
    redirect(withFlash(`${PATH}?new=1`, 'failed'));
  }

  await recordAudit(session, {
    action: 'partner.create',
    entityType: 'partner',
    entityId: created.id,
    details: { kind: input.kind, code: created.code, fee: input.fee },
  });
  revalidatePath(PATH);
  redirect(withFlash(`${PATH}/${created.id}`, 'created'));
}

/** Name, handle, notes, fee, status of a creator or campaign. The code never changes. */
export async function updatePartnerAction(formData) {
  const session = await requireAdmin('partners.manage');
  const id = Number.parseInt(formData.get('id'), 10);
  if (!Number.isSafeInteger(id) || id <= 0) redirect(PATH);
  const back = `${PATH}/${id}`;
  let input;
  try {
    input = parsePartnerForm(Object.fromEntries(formData), { creating: false });
  } catch (err) {
    redirect(withFlash(back, `invalid_${err.message}`));
  }

  let ok = false;
  try {
    ok = await updatePartner(id, input);
  } catch (err) {
    console.error(`[admin/partenaires] update #${id} failed: ${err.message}`);
  }
  if (!ok) redirect(withFlash(back, 'failed'));

  await recordAudit(session, {
    action: 'partner.update',
    entityType: 'partner',
    entityId: id,
    details: { status: input.status, fee: input.fee },
  });
  revalidatePath(PATH);
  revalidatePath(back);
  redirect(withFlash(back, 'saved'));
}

/** Switch any partner's code on or off — an agent's too. A switched-off code lands untagged and credits nobody. */
export async function setPartnerStatusAction(formData) {
  const session = await requireAdmin('partners.manage');
  const id = Number.parseInt(formData.get('id'), 10);
  const status = formData.get('status') === 'inactive' ? 'inactive' : 'active';
  if (!Number.isSafeInteger(id) || id <= 0) redirect(PATH);
  const back = `${PATH}/${id}`;

  let ok = false;
  try {
    ok = await setPartnerStatus(id, status);
  } catch (err) {
    console.error(`[admin/partenaires] status #${id} failed: ${err.message}`);
  }
  if (!ok) redirect(withFlash(back, 'failed'));

  await recordAudit(session, { action: `partner.${status === 'active' ? 'activate' : 'deactivate'}`, entityType: 'partner', entityId: id });
  revalidatePath(PATH);
  revalidatePath(back);
  redirect(withFlash(back, status === 'active' ? 'activated' : 'deactivated'));
}

const countField = (formData, name, { signed = false } = {}) => {
  const text = String(formData.get(name) ?? '').replace(/[\s.]/g, '');
  if (!text) return null;
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value) || (!signed && value < 0) || Math.abs(value) > 2e9) throw new Error(name);
  return value;
};

/**
 * A creator's TikTok figures for one week (growth plan item 20), typed from
 * their screenshots: posts, views, likes, followers gained. Any day of the
 * week is accepted and stored as its Monday; the same week typed again
 * replaces it. partners.stats.
 */
export async function saveSocialStatsAction(formData) {
  const session = await requireAdmin('partners.stats');
  const id = Number.parseInt(formData.get('id'), 10);
  if (!Number.isSafeInteger(id) || id <= 0) redirect(PATH);
  const back = `${PATH}/${id}`;
  const week = mondayOf(String(formData.get('week') || ''));
  if (!week) redirect(withFlash(back, 'invalid_week'));
  let figures;
  try {
    figures = {
      posts: countField(formData, 'posts'),
      views: countField(formData, 'views'),
      likes: countField(formData, 'likes'),
      followersGained: countField(formData, 'followers', { signed: true }),
    };
  } catch {
    redirect(withFlash(back, 'invalid_figures'));
  }
  try {
    await upsertSocialStats({
      partnerId: id,
      weekStart: week,
      ...figures,
      notes: String(formData.get('notes') || '').trim().slice(0, 500) || null,
      by: actorLabel(session).slice(0, 120),
    });
  } catch (err) {
    console.error(`[admin/partenaires] social stats #${id} failed: ${err.message}`);
    redirect(withFlash(back, 'failed'));
  }
  await recordAudit(session, { action: 'partner.social_stats', entityType: 'partner', entityId: id, details: { week, ...figures } });
  revalidatePath(back);
  redirect(withFlash(back, 'stats_saved'));
}
