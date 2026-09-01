'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getPool } from '@/lib/db';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';

/** Same defense-in-depth pattern as web/app/admin/listings/actions.js. */
async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

export async function updateAgentStatusAction(agentId, formData) {
  await assertAdminSession();
  const status = Number.parseInt(formData.get('status'), 10);
  if (![0, 1].includes(status)) throw new Error('status must be 0 or 1');

  const pool = getPool();
  await pool.query('UPDATE agents SET status = $1, updated_at = NOW() WHERE id = $2', [status, agentId]);
  revalidatePath('/admin/agents');
}

/**
 * No FK constrains agents.vendor_id at the database level (confirmed via
 * information_schema), so a bad vendorId would silently "succeed" and orphan
 * the agent from a real agency — validated here instead.
 */
export async function reassignAgentVendorAction(agentId, formData) {
  await assertAdminSession();
  const raw = formData.get('vendor_id');
  const vendorId = raw ? Number.parseInt(raw, 10) : null;

  const pool = getPool();

  if (vendorId !== null) {
    const { rows } = await pool.query('SELECT id FROM vendors WHERE id = $1', [vendorId]);
    if (!rows.length) throw new Error(`No vendor #${vendorId}`);
  }

  await pool.query('UPDATE agents SET vendor_id = $1, updated_at = NOW() WHERE id = $2', [vendorId, agentId]);
  revalidatePath('/admin/agents');
}

/**
 * properties.agent_id is NULL on every real row today (confirmed directly)
 * — this is the first thing to ever populate it, not a fix to a broken link.
 * Same unenforced-at-the-DB-level situation as vendor_id above, so the
 * listing id is validated for real before writing.
 */
export async function assignAgentToListingAction(propertyId, agentId) {
  await assertAdminSession();
  const pool = getPool();

  const { rows } = await pool.query('SELECT id FROM properties WHERE id = $1', [propertyId]);
  if (!rows.length) throw new Error(`No property #${propertyId}`);

  await pool.query('UPDATE properties SET agent_id = $1, updated_at = NOW() WHERE id = $2', [agentId, propertyId]);
  revalidatePath('/admin/agents');
  revalidatePath('/admin/listings');
}

/**
 * Backs the public agent storefront's "Communes desservies" section
 * (web/app/(site)/agents/[id]/page.js). agents.primary_communes is a plain
 * TEXT[] column — no real "selected communes" concept existed anywhere in
 * this schema before Phase 3A added it, so this is genuinely new capability,
 * not a fix to an existing field. Values are only ever taken from the real,
 * canonical commune list (getLocationHierarchySafe(), the engine's own
 * kinshasa_locations.json-backed hierarchy) — never free text — so a stray
 * checkbox value can't smuggle an invented commune name onto a public page.
 *
 * Called directly from AgentCommunesForm.js (a client component), not just
 * as a plain `<form action>`, so it can drive a pending state and a toast —
 * same {ok, error} result shape every other client-invoked action in web/
 * uses (see app/compte/agent/actions.js).
 */
export async function updateAgentCommunesAction(agentId, validCommunes, formData) {
  try {
    await assertAdminSession();
    const validSet = new Set(validCommunes);
    const selected = formData.getAll('communes').filter((c) => validSet.has(c));

    const pool = getPool();
    await pool.query('UPDATE agents SET primary_communes = $1, updated_at = NOW() WHERE id = $2', [
      selected,
      agentId,
    ]);
    revalidatePath('/admin/agents');
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'La mise à jour a échoué.' };
  }
}
