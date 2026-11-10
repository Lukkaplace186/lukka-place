'use server';

import { revalidatePath } from 'next/cache';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getAccountPhones } from '@/lib/customerPhoneChange';
import { answerRequestFollowup } from '@/lib/adminApi';

const ANSWERS = new Set(['YES', 'NOT_YET', 'NO_LONGER']);

/**
 * One of the three answers to "Un agent vous a-t-il contacté ?". The numbers
 * sent are the signed-in account's own (never the form's); the engine
 * accepts the answer only for a request made from one of them.
 * @returns {Promise<{ok: boolean, answer?: string, error?: 'auth'|'invalid'|'not-found'|'failed'}>}
 */
export async function answerFollowupAction(leadId, answer) {
  const session = await getPortalCustomer();
  if (!session) return { ok: false, error: 'auth' };
  const id = Number.parseInt(String(leadId), 10);
  if (!Number.isSafeInteger(id) || id <= 0 || !ANSWERS.has(answer)) return { ok: false, error: 'invalid' };
  try {
    const waIds = await getAccountPhones(session.customerId, session.customer.phone);
    const result = await answerRequestFollowup(id, { answer, waIds });
    revalidatePath(`/compte/client/suivi/${id}`);
    revalidatePath('/compte/client/messages');
    return { ok: true, answer: result?.answer || answer };
  } catch (err) {
    if (err.status === 404) return { ok: false, error: 'not-found' };
    console.error(`[compte/client/suivi] answer for lead #${id} failed: ${err.message}`);
    return { ok: false, error: 'failed' };
  }
}
