'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { parseAgentListingText } from '@/lib/adminApi';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { insertManualObservation, setObservationExclusion } from '@/lib/marketGuide';
import {
  MANUAL_EXCLUSION_CODES,
  manualSourceRef,
  prefillFromExtraction,
  validateManualObservation,
} from '@/lib/marketObservationRules';
import { getT } from '@/lib/i18n/server';

const PATH = '/admin/market-data/marche';

/**
 * Reads a pasted post (Facebook, Zwandako…) with the engine's own listing
 * extractor and returns the entry form's fields. Nothing is stored: the team
 * member checks every field and saves. The pasted text is never kept.
 */
export async function readPastedPostAction(text) {
  const t = await getT();
  try {
    await requireAdmin('market.manage');
    const clean = String(text || '').trim();
    if (clean.length < 15) return { ok: false, error: t('admin.marketObservations.errors.pasteShort') };
    if (clean.length > 5000) return { ok: false, error: t('admin.marketObservations.errors.pasteLong') };
    const [result, hierarchy] = await Promise.all([parseAgentListingText(clean), getLocationHierarchyWithFallback({ city: 'all' })]);
    return { ok: true, fields: prefillFromExtraction(result?.extracted_data, hierarchy.communes) };
  } catch (err) {
    console.error(`[admin/market] paste read failed: ${err.message}`);
    return { ok: false, error: t('admin.marketObservations.errors.pasteFailed') };
  }
}

/** Saves one hand-entered observation. Same advert link twice → one row. */
export async function addObservationAction(formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('market.manage');
    const hierarchy = await getLocationHierarchyWithFallback({ city: 'all' });
    const input = Object.fromEntries(formData.entries());
    const check = validateManualObservation(input, { communes: hierarchy.communes });
    if (!check.ok) return { ok: false, error: t(`admin.marketObservations.errors.${check.error}`) };
    const saved = await insertManualObservation(check.value, manualSourceRef(check.value), session.id);
    if (saved.duplicate) return { ok: false, error: t('admin.marketObservations.errors.duplicate') };
    await recordAudit(session, {
      action: 'market.observation_add',
      entityType: 'market_observation',
      entityId: String(saved.id),
      details: { source: check.value.source, commune: check.value.commune, beds: check.value.beds, monthly_usd: check.value.monthly_usd, price_usd: check.value.price_usd },
    });
    revalidatePath(PATH);
    revalidatePath('/combien-coute');
    return { ok: true, message: t('admin.marketObservations.saved') };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** Exclude (with a reason code) or restore one observation. */
export async function setExclusionAction(id, code) {
  const t = await getT();
  try {
    const session = await requireAdmin('market.manage');
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) return { ok: false, error: t('errors.actionFailed') };
    if (code !== null && !MANUAL_EXCLUSION_CODES.includes(code)) return { ok: false, error: t('errors.actionFailed') };
    const row = await setObservationExclusion(numericId, code ? `manual:${code}` : null);
    if (!row) return { ok: false, error: t('admin.marketObservations.errors.restoreAutomatic') };
    await recordAudit(session, {
      action: code ? 'market.observation_exclude' : 'market.observation_restore',
      entityType: 'market_observation',
      entityId: String(numericId),
      details: { reason: code },
    });
    revalidatePath(PATH);
    revalidatePath('/combien-coute');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
