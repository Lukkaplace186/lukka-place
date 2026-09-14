import { loginAction, sharedLoginAction } from './actions';
import { sharedPasswordEnabled } from '@/lib/adminAuth';
import { getT } from '@/lib/i18n/server';

// generateMetadata, not a static object: a static export is evaluated at
// module load, where there is no request and so no translator.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('admin.meta.loginTitle'),
    robots: { index: false, follow: false },
  };
}

const ERROR_KEYS = {
  invalid: 'admin.login.errorInvalid',
  locked: 'admin.login.errorLocked',
  throttled: 'admin.login.errorThrottled',
  revoked: 'admin.login.errorRevoked',
  disabled: 'admin.login.errorSharedDisabled',
};

const FIELD = 'u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink';
const LABEL = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45';

/**
 * Sign in with an individual team account. The shared team password stays
 * available underneath while `ADMIN_SHARED_LOGIN` is not `off`, as the way in
 * for whoever creates the first accounts — it is labelled as such, and
 * everything done under it is audited as the shared password.
 */
export default async function AdminLoginPage({ searchParams }) {
  const t = await getT();
  const params = (await searchParams) || {};
  const errorKey = ERROR_KEYS[params.error];
  const next = typeof params.next === 'string' ? params.next : '/admin/dashboard';
  const shared = sharedPasswordEnabled();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas-alt px-4">
      <div className="u-lift w-full max-w-sm rounded-card border border-line bg-surface p-6 sm:p-8">
        <h1 className="u-title-page text-ink">
          {t('footer.columns.brand').split(' ')[0]} <span className="text-blue-deep">{t('admin.chrome.brandSuffix')}</span>
        </h1>
        <p className="mt-1 text-sm text-ink-45">{t('admin.login.intro')}</p>

        {errorKey ? (
          <p className="mt-4 rounded-md bg-danger-tint px-3 py-2 text-sm text-danger" role="alert">
            {t(errorKey)}
          </p>
        ) : null}

        <form action={loginAction} className="mt-5 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <div>
            <label htmlFor="email" className={LABEL}>{t('admin.login.email')}</label>
            <input id="email" type="email" name="email" autoComplete="username" autoFocus required className={FIELD} />
          </div>
          <div>
            <label htmlFor="password" className={LABEL}>{t('admin.login.password')}</label>
            <input id="password" type="password" name="password" autoComplete="current-password" required className={FIELD} />
          </div>
          <button
            type="submit"
            className="u-btn-primary mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
          >
            {t('admin.login.submit')}
          </button>
          <p className="text-xs text-ink-45">{t('admin.login.accountHint')}</p>
        </form>

        {shared ? (
          <details className="mt-6 border-t border-line pt-4" open={params.shared === '1'}>
            <summary className="cursor-pointer text-sm font-semibold text-blue-deep">{t('admin.login.sharedSummary')}</summary>
            <p className="mt-2 text-xs text-ink-45">{t('admin.login.sharedHint')}</p>
            <form action={sharedLoginAction} className="mt-3 flex flex-col gap-3">
              <input type="hidden" name="next" value={next} />
              <div>
                <label htmlFor="shared-password" className={LABEL}>{t('admin.login.sharedPassword')}</label>
                <input id="shared-password" type="password" name="password" autoComplete="off" required className={FIELD} />
              </div>
              <button type="submit" className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-canvas-alt">
                {t('admin.login.sharedSubmit')}
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </div>
  );
}
