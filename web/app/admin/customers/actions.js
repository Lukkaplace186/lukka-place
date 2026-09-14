'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { recordAudit } from '@/lib/adminAudit';
import { adminSetAccountPassword } from '@/lib/adminPasswordReset';
import { adminUnlockCustomer } from '@/lib/customers';
import { getT } from '@/lib/i18n/server';

/**
 * Customers have no activation-link equivalent, so an admin-set password is
 * the only way back into a locked account without a working WhatsApp OTP.
 * Same lib/adminPasswordReset.js write as the agent side. The password is never
 * returned, logged or audited — only the fact that it was set.
 */
export async function adminSetCustomerPasswordAction(customerId, formData) {
  const t = await getT();
  try {
    const session = await requireAdmin('customers.manage');
    const { errorKey, ...result } = await adminSetAccountPassword({
      role: 'customer',
      id: customerId,
      password: formData.get('password'),
      confirm: formData.get('password_confirm'),
    });
    if (errorKey) return { ...result, error: t(errorKey) };
    await recordAudit(session, { action: 'customer.password_set', entityType: 'customer', entityId: customerId });
    revalidatePath('/admin/customers');
    revalidatePath(`/admin/customers/${customerId}`);
    return result;
  } catch (err) {
    console.error(`[admin/customers] password reset #${customerId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}

/** Lift a login lockout — the password and sessions are left as they are. */
export async function adminUnlockCustomerAction(customerId) {
  const t = await getT();
  try {
    const session = await requireAdmin('customers.manage');
    const changed = await adminUnlockCustomer(customerId);
    if (!changed) return { ok: false, error: t('admin.customers.notFound') };
    await recordAudit(session, { action: 'customer.unlock', entityType: 'customer', entityId: customerId });
    revalidatePath('/admin/customers');
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true, message: t('admin.customers.unlocked') };
  } catch (err) {
    console.error(`[admin/customers] unlock #${customerId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
