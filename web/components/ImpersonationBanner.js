import { cookies } from 'next/headers';
import { IMPERSONATION_COOKIE } from '@/lib/impersonationToken';
import { getImpersonationState } from '@/lib/impersonation';
import { getT } from '@/lib/i18n/server';

/**
 * The unmissable "you are viewing as someone else" bar, on every page of the
 * storefront, the agent dashboard and the console while an impersonation
 * cookie is present.
 *
 * Fixed to the bottom of the viewport rather than the top: the storefront's
 * header is fixed at top-0 and several sticky offsets (FilterBar, the map) are
 * computed from it, so a top bar would either cover the header or shift every
 * one of them.
 *
 * A plain form POST to the exit route — it must work with JavaScript broken,
 * and it is a navigation, not a Server Action (those are refused in read-only
 * mode).
 */
export default async function ImpersonationBanner() {
  let token;
  try {
    token = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!token) return null;

  let state = null;
  try {
    state = await getImpersonationState(token);
  } catch (err) {
    console.error(`[impersonation] banner could not read the session: ${err.message}`);
  }
  if (!state) return null;

  const t = await getT();
  const { active, row } = state;
  const role = t(row.target_type === 'agent' ? 'common.impersonation.roleAgent' : 'common.impersonation.roleCustomer');
  const until = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kinshasa' })
    .format(new Date(row.expires_at));

  return (
    <div
      role="status"
      data-impersonation={active ? 'active' : 'ended'}
      className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-card bg-ink px-4 py-3 text-white shadow-lg print:hidden"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="u-micro-strong">
            {active
              ? t('common.impersonation.active', { name: row.target_label || `#${row.target_id}`, role })
              : t('common.impersonation.ended')}
          </div>
          {active ? <div className="u-micro text-white/75">{t('common.impersonation.readOnly', { time: until })}</div> : null}
        </div>
        <form action="/admin/impersonation/exit" method="post">
          <button type="submit" className="u-press u-micro-strong rounded-md bg-white px-3 py-1.5 text-ink hover:bg-white/90">
            {t('common.impersonation.exit')}
          </button>
        </form>
      </div>
    </div>
  );
}
