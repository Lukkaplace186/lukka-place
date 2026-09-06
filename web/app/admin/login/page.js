import { loginAction } from './actions';
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

/**
 * Plain Server Component + form action — no client JS needed, matches the
 * rest of the app's form conventions (FilterBar, SearchBar, etc.). Errors
 * come back as ?error=1 (see actions.js's redirect), not client state.
 */
export default async function AdminLoginPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const hasError = params.error === '1';
  const next = typeof params.next === 'string' ? params.next : '/admin/conversations';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 u-lift sm:p-8">
        <h1 className="u-title-page text-ink">
          {t('footer.columns.brand').split(' ')[0]} <span className="text-blue-deep">{t('admin.chrome.brandSuffix')}</span>
        </h1>
        <p className="mt-1 text-sm text-ink-45">{t('admin.login.intro')}</p>

        <form action={loginAction} className="mt-6 flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              {t('admin.login.password')}
            </label>
            <input
              id="password"
              type="password"
              name="password"
              autoFocus
              required
              className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
            />
          </div>

          {hasError && (
            <p className="text-sm text-red-600" role="alert">
              {t('admin.login.wrongPassword')}
            </p>
          )}

          <button
            type="submit"
            className="mt-1 rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
          >
            {t('admin.login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
