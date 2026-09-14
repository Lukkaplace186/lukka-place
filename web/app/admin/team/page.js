import { listAdminUsers } from '@/lib/adminUsers';
import { ADMIN_ROLES, ROLE_LABEL_KEYS } from '@/lib/adminRoles';
import { sharedPasswordEnabled } from '@/lib/adminAuth';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import { ErrorNote } from '../LeadRoutingUI';
import TeamManager from './TeamManager';

export const dynamic = 'force-dynamic';

/**
 * Who can use the console, and with which role. Owner only (the layout
 * enforces `team.manage`). The shared password's status is stated here too,
 * because it is the one way in that has no name attached.
 */
export default async function AdminTeamPage() {
  const t = await getT();
  const session = await getAdminSession();
  let users = [];
  let loadError = null;
  try {
    users = await listAdminUsers();
  } catch (err) {
    loadError = err.message;
  }
  const activeOwners = users.filter((user) => user.role === 'owner' && user.status === 'active').length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.team.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.team.subtitle')}</p>
      </div>

      {loadError ? <ErrorNote>{t('admin.team.loadError', { error: loadError })}</ErrorNote> : null}

      {sharedPasswordEnabled() ? (
        <div className="rounded-card border border-warning/40 bg-warning-tint p-4 text-sm text-ink-70">
          <p className="font-semibold text-ink">{t('admin.team.sharedOnTitle')}</p>
          <p className="mt-1">{activeOwners > 0 ? t('admin.team.sharedOnReady') : t('admin.team.sharedOnBootstrap')}</p>
        </div>
      ) : null}

      <TeamManager users={users} currentAdminId={session?.id ?? null} />

      <section className="u-card rounded-card bg-surface p-5">
        <h2 className="u-title-card text-ink">{t('admin.team.rolesTitle')}</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {ADMIN_ROLES.map((role) => (
            <div key={role}>
              <dt className="u-micro-strong text-ink">{t(ROLE_LABEL_KEYS[role])}</dt>
              <dd className="u-micro text-ink-70">{t(`admin.team.roleHelp.${role}`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
