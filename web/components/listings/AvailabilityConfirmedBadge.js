import { CalendarCheck } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { badgeConfirmationDate, formatConfirmationDate } from '@/lib/listingAvailability';

/**
 * "Disponibilité confirmée le 21 sept." — the listing's own agent said it is
 * still available, on that day (properties.availability_confirmed_at, set by
 * the agent dashboard's "Toujours disponible ?" check).
 *
 * Renders only for a real confirmation no older than BADGE_MAX_AGE_DAYS, and
 * nothing at all otherwise: no "non confirmé", no stand-in date. A listing
 * nobody confirmed is not thereby unavailable, and saying so would shame the
 * agent with a claim we cannot back either way.
 *
 * Deliberately worded as the agent's confirmation, not "Vérifié": that word
 * belongs to properties.verified_at, a check by our own team.
 */
export default async function AvailabilityConfirmedBadge({ confirmedAt }) {
  const date = badgeConfirmationDate(confirmedAt);
  if (!date) return null;
  const t = await getT();
  return (
    <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success-tint px-2.5 py-1 text-[0.8125rem] font-semibold text-success">
      <CalendarCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
      {t('listings.availability.confirmedOn', { date: formatConfirmationDate(date, t.locale) })}
    </p>
  );
}
