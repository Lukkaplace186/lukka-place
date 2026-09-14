import { getInviteByToken, MIN_PASSWORD_LENGTH } from '@/lib/adminUsers';
import { ROLE_LABEL_KEYS } from '@/lib/adminRoles';
import { getT } from '@/lib/i18n/server';
import { activateAdminAction } from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('admin.activate.metaTitle'), robots: { index: false, follow: false } };
}

const FIELD = 'u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45';

/** Where an invited team member chooses their own password. Public, gated by the link's token. */
export default async function AdminActivatePage({ searchParams }) {
  const t = await getT();
  const params = (await searchParams) || {};
  const token = typeof params.token === 'string' ? params.token : '';
  const invite = token ? await getInviteByToken(token).catch(() => null) : null;
  const errorKey = typeof params.error === 'string' && params.error.startsWith('admin.team.') ? params.error : null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas-alt px-4">
      <div className="u-lift w-full max-w-sm rounded-card border border-line bg-surface p-6 sm:p-8">
        <h1 className="u-title-section text-ink">{t('admin.activate.title')}</h1>
        {!invite ? (
          <p className="mt-3 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger" role="alert">
            {t('admin.team.linkExpired')}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-70">
              {t('admin.activate.intro', { name: invite.full_name, role: t(ROLE_LABEL_KEYS[invite.role]) })}
            </p>
            <p className="mt-1 text-xs text-ink-45">{invite.email}</p>
            {errorKey ? (
              <p className="mt-4 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger" role="alert">
                {t(errorKey, { min: MIN_PASSWORD_LENGTH })}
              </p>
            ) : null}
            <form action={activateAdminAction} className="mt-5 flex flex-col gap-3">
              <input type="hidden" name="token" value={token} />
              <div>
                <label htmlFor="password" className={LABEL}>{t('admin.activate.password')}</label>
                <input id="password" type="password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required className={FIELD} />
              </div>
              <div>
                <label htmlFor="password_confirm" className={LABEL}>{t('admin.activate.confirm')}</label>
                <input id="password_confirm" type="password" name="password_confirm" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required className={FIELD} />
              </div>
              <p className="text-xs text-ink-45">{t('admin.activate.rule', { min: MIN_PASSWORD_LENGTH })}</p>
              <button type="submit" className="u-btn-primary rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-deep">
                {t('admin.activate.submit')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
