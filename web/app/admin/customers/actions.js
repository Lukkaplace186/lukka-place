'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ADMIN_SESSION_COOKIE, isValidSessionToken } from '@/lib/adminAuth';
import { adminSetAccountPassword } from '@/lib/adminPasswordReset';
import { getT } from '@/lib/i18n/server';

// Local copy, matching app/admin/actions.js, app/admin/agents/actions.js and
// app/admin/agents/[id]/actions.js — this console's existing convention.
async function assertAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionToken(token)) throw new Error('Not authenticated');
}

/**
 * Customers have no activation-link equivalent (that mechanism is an agents
 * table feature), so before this there was no way at all to get a customer
 * back into a locked account without a working WhatsApp OTP. Same
 * lib/adminPasswordReset.js write as the agent side, so both roles get the
 * same guarantees — sessions invalidated, lockout cleared.
 */
export async function adminSetCustomerPasswordAction(customerId, formData) {
  const t = await getT();
  try {
    await assertAdminSession();
    const { errorKey, ...result } = await adminSetAccountPassword({
      role: 'customer',
      id: customerId,
      password: formData.get('password'),
      confirm: formData.get('password_confirm'),
    });
    if (errorKey) return { ...result, error: t(errorKey) };
    revalidatePath('/admin/customers');
    return result;
  } catch (err) {
    console.error(`[admin/customers] password reset #${customerId} failed: ${err.message}`);
    return { ok: false, error: err.message || t('errors.actionFailed') };
  }
}
