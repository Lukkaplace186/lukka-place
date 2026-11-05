'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { parseAgentListingText, parseMarketPaste } from '@/lib/adminApi';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { insertManualObservation, setObservationExclusion } from '@/lib/marketGuide';
import { knownPhones, saveMarketPasteBatch } from '@/lib/marketProspects';
import {
  MAX_PASTE_CHARS,
  MAX_PASTE_ROWS,
  advertToRow,
  observationInput,
  validateProspect,
} from '@/lib/marketProspectRules';
import {
  MANUAL_EXCLUSION_CODES,
  MANUAL_SOURCES,
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

/**
 * "Coller des annonces", step 1: the engine reads the paste into separate
 * adverts with their posters; each becomes an editable row, flagged when the
 * number is already on the prospects list or is a Lukka Place agent.
 * Nothing is stored.
 */
export async function readMarketPasteAction(text) {
  const t = await getT();
  try {
    await requireAdmin('market.manage');
    const clean = String(text || '').trim();
    if (clean.length < 15) return { ok: false, error: t('admin.marketObservations.errors.pasteShort') };
    if (clean.length > MAX_PASTE_CHARS) return { ok: false, error: t('admin.marketPaste.errors.tooLong', { max: MAX_PASTE_CHARS }) };
    const [result, hierarchy] = await Promise.all([parseMarketPaste(clean), getLocationHierarchyWithFallback({ city: 'all' })]);
    const rows = (result?.adverts || []).slice(0, MAX_PASTE_ROWS).map((advert, i) => advertToRow(advert, i, { communes: hierarchy.communes }));
    if (!rows.length) return { ok: false, error: t('admin.marketPaste.errors.noAdverts') };
    const known = await knownPhones(rows.map((row) => row.phone)).catch(() => ({}));
    return { ok: true, rows: rows.map((row) => ({ ...row, known: known[row.phone] || null })) };
  } catch (err) {
    console.error(`[admin/market] market paste read failed: ${err.message}`);
    return { ok: false, error: t('admin.marketObservations.errors.pasteFailed') };
  }
}

/**
 * Step 2: one save for the whole checked table — the prices to
 * market_observations, the posters to market_prospects, in one transaction.
 * A row that fails its check is reported by number and nothing is written,
 * so the team member fixes it and saves again.
 */
export async function saveMarketPasteAction({ source, sourceUrl, rows }) {
  const t = await getT();
  try {
    const session = await requireAdmin('market.manage');
    if (!MANUAL_SOURCES.includes(source)) return { ok: false, error: t('admin.marketObservations.errors.source') };
    let url = String(sourceUrl || '').trim();
    if (url) {
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol');
        url = parsed.toString();
      } catch {
        return { ok: false, error: t('admin.marketObservations.errors.url') };
      }
    }
    const list = Array.isArray(rows) ? rows.slice(0, MAX_PASTE_ROWS) : [];
    const hierarchy = await getLocationHierarchyWithFallback({ city: 'all' });
    const items = [];
    for (const [index, row] of list.entries()) {
      const n = index + 1;
      let observation = null;
      if (row.keepPrice) {
        const check = validateManualObservation(observationInput(row, { source, sourceUrl: url }), { communes: hierarchy.communes, requireUrl: false });
        if (!check.ok) return { ok: false, error: t('admin.marketPaste.errors.row', { n, error: t(`admin.marketObservations.errors.${check.error}`) }) };
        observation = check.value;
      }
      const prospect = validateProspect(row);
      if (!prospect.ok) return { ok: false, error: t('admin.marketPaste.errors.row', { n, error: t(`admin.marketPaste.errors.${prospect.error}`) }) };
      if (observation || prospect.value) items.push({ observation, prospect: prospect.value });
    }
    if (!items.length) return { ok: false, error: t('admin.marketPaste.errors.nothingKept') };

    const saved = await saveMarketPasteBatch(items, { source, sourceUrl: url || null, recordedBy: session.id || null });
    await recordAudit(session, {
      action: 'market.paste_batch',
      entityType: 'market_observation',
      entityId: saved.observationIds[0] ? String(saved.observationIds[0]) : null,
      details: {
        source,
        rows: list.length,
        prices_saved: saved.pricesSaved,
        prices_duplicate: saved.pricesDuplicate,
        prospects_new: saved.prospectsNew,
        prospects_updated: saved.prospectsUpdated,
      },
    });
    revalidatePath(PATH);
    revalidatePath('/admin/market-data/prospects');
    revalidatePath('/combien-coute');
    return {
      ok: true,
      message: t('admin.marketPaste.saved', {
        prices: saved.pricesSaved,
        duplicates: saved.pricesDuplicate,
        newProspects: saved.prospectsNew,
        updatedProspects: saved.prospectsUpdated,
      }),
    };
  } catch (err) {
    console.error(`[admin/market] market paste save failed: ${err.message}`);
    if (err.code === '42P01') return { ok: false, error: t('admin.marketPaste.errors.notMigrated') };
    return { ok: false, error: t('errors.actionFailed') };
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
