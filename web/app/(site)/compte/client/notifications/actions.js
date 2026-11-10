'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentCustomerId } from '@/lib/customers';
import { markAllNotificationsRead, setNotificationPreference } from '@/lib/pushNotifications';
import { switchableCustomerCategory } from '@/lib/pushRules';

/** "Tout marquer comme lu" on the customer's Notifications. */
export async function markAllCustomerNotificationsReadAction() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return;
  try {
    await markAllNotificationsRead('customer', customerId);
  } catch (err) {
    console.error(`[notifications] mark all read failed for customer #${customerId}: ${err.message}`);
  }
  revalidatePath('/compte/client/notifications');
}

/**
 * One switch on Mon profil › Notifications: whether the app may push this
 * kind of alert. Off means WhatsApp only, as before (its own switch is the
 * account-wide WhatsApp alerts one). Visits cannot be switched off.
 * @returns {Promise<{ok: boolean, unavailable?: boolean}>}
 */
export async function setNotificationCategoryAction(category, enabled) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return { ok: false };
  const key = switchableCustomerCategory(category);
  if (!key) return { ok: false };
  try {
    const result = await setNotificationPreference('customer', customerId, key, enabled === true);
    if (result !== 'ok') return { ok: false, unavailable: true };
  } catch (err) {
    console.error(`[notifications] preference ${key} failed for customer #${customerId}: ${err.message}`);
    return { ok: false };
  }
  revalidatePath('/compte/client/parametres');
  return { ok: true };
}
