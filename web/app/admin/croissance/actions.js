'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/adminSession';
import { actorLabel, recordAudit } from '@/lib/adminAudit';
import { upsertAdSpend } from '@/lib/growthDashboard';
import { weekStart } from '@/lib/growthRules';
import { kinshasaDay, setListingOfTheDay } from '@/lib/browseFeatures';

const PATH = '/admin/croissance';
const SPEND_CHANNELS = ['meta_ads', 'tiktok_ads', 'google_ads', 'other_paid'];

/** One week's spend on one paid channel (any day of the week is stored as its Monday). */
export async function saveAdSpendAction(formData) {
  const session = await requireAdmin('partners.stats');
  const week = weekStart(String(formData.get('week') || ''));
  const channel = String(formData.get('channel') || '');
  const currency = formData.get('currency') === 'CDF' ? 'CDF' : 'USD';
  const amount = Number(String(formData.get('amount') || '').replace(/\s/g, '').replace(',', '.'));
  if (!week || !SPEND_CHANNELS.includes(channel) || !Number.isFinite(amount) || amount < 0 || amount > 1e9) {
    redirect(`${PATH}?flash=spend_invalid`);
  }
  try {
    await upsertAdSpend({ weekStart: week, channel, amount: Math.round(amount * 100) / 100, currency, by: actorLabel(session).slice(0, 120) });
  } catch (err) {
    console.error(`[admin/croissance] spend failed: ${err.message}`);
    redirect(`${PATH}?flash=failed`);
  }
  await recordAudit(session, { action: 'growth.ad_spend', details: { week, channel, amount, currency } });
  revalidatePath(PATH);
  redirect(`${PATH}?flash=spend_saved`);
}

/** The team's "Bien du jour" for today (Kinshasa): a public listing's number. */
export async function pickListingOfTheDayAction(formData) {
  const session = await requireAdmin('listings.edit');
  const propertyId = Number.parseInt(formData.get('property_id'), 10);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0) redirect(`${PATH}?flash=pick_invalid`);
  let ok = false;
  try {
    ok = await setListingOfTheDay({ day: kinshasaDay(), propertyId, by: actorLabel(session).slice(0, 120) });
  } catch (err) {
    console.error(`[admin/croissance] pick failed: ${err.message}`);
  }
  if (!ok) redirect(`${PATH}?flash=pick_invalid`);
  await recordAudit(session, { action: 'growth.listing_of_the_day', entityType: 'listing', entityId: propertyId });
  revalidatePath(PATH);
  revalidatePath('/bien-du-jour');
  redirect(`${PATH}?flash=picked`);
}
