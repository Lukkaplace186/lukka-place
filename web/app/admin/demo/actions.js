'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { getPool } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { isDemoPhone } from '@/lib/demoPhone';
import {
  createDemoAccount, deleteDemoAccount, getDemoAccount, parseDemoForm, resetDemoAccount, updateDemoDeliverTo,
} from '@/lib/demoAccounts';
import { clearDemoSessionCookies, setDemoSessionCookies } from '@/lib/demoSession';
import { endImpersonationFromCookies } from '@/lib/impersonationCookies';
import { getT } from '@/lib/i18n/server';

/**
 * /admin/demo — demo customer + agent pairs (lib/demoAccounts.js). Every
 * action needs `accounts.demo` and is audited.
 */

function actorOf(session) {
  return session.shared ? 'shared-password' : (session.name || session.email || `admin #${session.id}`);
}

export async function createDemoAccountAction(formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('accounts.demo');
    const parsed = parseDemoForm(formData, { normalizePhone });
    if (!parsed.ok) return { ok: false, error: t(parsed.errorKey) };
    const result = await createDemoAccount({ ...parsed.values, createdBy: actorOf(session) });
    if (!result.ok) return { ok: false, error: t(result.errorKey) };
    await recordAudit(session, {
      action: 'demo.create',
      entityType: 'demo_account',
      entityId: result.pair.id,
      details: {
        label: result.pair.label,
        agentId: result.pair.agentId,
        customerId: result.pair.customerId,
        copiesToPhone: Boolean(result.pair.deliverTo),
      },
    });
    revalidatePath('/admin/demo');
    return { ok: true, id: result.pair.id };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** Sign this browser into the demo customer or agent, then the caller navigates. */
export async function openDemoSideAction(pairId, side) {
  const t = await getT();
  try {
    const session = await requireAdmin('accounts.demo');
    if (!['agent', 'customer'].includes(side)) return { ok: false, error: t('errors.actionFailed') };
    const pair = await getDemoAccount(pairId);
    if (!pair || !pair.agentId || !pair.customerId) return { ok: false, error: t('admin.demo.notFound') };

    // The token versions, and a last check that these really are the demo
    // numbers (a session is about to be minted for them).
    const { rows } = await getPool().query(
      `SELECT (SELECT phone FROM agents WHERE id = $1) AS agent_phone,
              (SELECT COALESCE(token_version, 0) FROM agents WHERE id = $1) AS agent_tv,
              (SELECT phone FROM customers WHERE id = $2) AS customer_phone,
              (SELECT COALESCE(token_version, 1) FROM customers WHERE id = $2) AS customer_tv`,
      [pair.agentId, pair.customerId],
    );
    const row = rows[0] || {};
    if (!isDemoPhone(row.agent_phone) || !isDemoPhone(row.customer_phone)) {
      return { ok: false, error: t('admin.demo.notFound') };
    }

    const cookieStore = await cookies();
    // A read-only "view as" would refuse every click of the demo.
    await endImpersonationFromCookies(cookieStore, 'replaced').catch(() => null);
    setDemoSessionCookies(cookieStore, pair, side, {
      agentTokenVersion: Number(row.agent_tv),
      customerTokenVersion: Number(row.customer_tv),
    });
    await recordAudit(session, { action: 'demo.open', entityType: 'demo_account', entityId: pair.id, details: { side } });
    return { ok: true, redirectTo: side === 'agent' ? '/compte/agent' : '/compte/client' };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function resetDemoAccountAction(pairId) {
  const t = await getT();
  try {
    const session = await requireAdmin('accounts.demo');
    const result = await resetDemoAccount(pairId);
    if (!result.ok) return { ok: false, error: t(result.errorKey) };
    clearDemoSessionCookies(await cookies());
    await recordAudit(session, {
      action: 'demo.reset',
      entityType: 'demo_account',
      entityId: Number(pairId),
      details: {
        listingsDeleted: result.postgres?.listings ?? 0,
        engine: result.engine?.error ? `failed: ${result.engine.error}` : result.engine?.deleted || {},
        agentId: result.agentId,
        customerId: result.customerId,
      },
    });
    revalidatePath('/admin/demo');
    return { ok: true, engineError: result.engine?.error || null };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function deleteDemoAccountAction(pairId) {
  const t = await getT();
  try {
    const session = await requireAdmin('accounts.demo');
    const result = await deleteDemoAccount(pairId);
    if (!result.ok) return { ok: false, error: t(result.errorKey) };
    clearDemoSessionCookies(await cookies());
    await recordAudit(session, {
      action: 'demo.delete',
      entityType: 'demo_account',
      entityId: Number(pairId),
      details: {
        listingsDeleted: result.postgres?.listings ?? 0,
        engine: result.engine?.error ? `failed: ${result.engine.error}` : result.engine?.deleted || {},
      },
    });
    revalidatePath('/admin/demo');
    return { ok: true, engineError: result.engine?.error || null };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

export async function updateDemoDeliverToAction(pairId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('accounts.demo');
    const raw = String(formData.get('deliver_to') || '').trim();
    let phone = null;
    if (raw) {
      phone = normalizePhone(raw, String(formData.get('deliver_toCountry') || ''));
      if (!phone || !/^\d{7,15}$/.test(phone) || isDemoPhone(phone)) return { ok: false, error: t('admin.demo.errorPhone') };
    }
    const changed = await updateDemoDeliverTo(pairId, phone);
    if (!changed) return { ok: false, error: t('admin.demo.notFound') };
    await recordAudit(session, {
      action: 'demo.copies',
      entityType: 'demo_account',
      entityId: Number(pairId),
      details: { copiesToPhone: Boolean(phone) },
    });
    revalidatePath('/admin/demo');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** "Quitter la démo": signs this browser out of both demo sides. */
export async function exitDemoAction() {
  clearDemoSessionCookies(await cookies());
  return { ok: true, redirectTo: '/admin/demo' };
}
