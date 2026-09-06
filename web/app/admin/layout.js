import { logoutAction } from './actions';
import AdminSidebar from './AdminSidebar';
import LanguageToggle from '@/components/LanguageToggle';
import { ToastProvider } from '@/components/Toast';
import { getI18n, getT } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// generateMetadata rather than a static object — see app/(site)/a-propos.
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('admin.meta.title'),
    robots: { index: false, follow: false },
  };
}

/*
 * The admin console's own namespaces, layered on the chrome ones the root
 * layout supplies (I18nProvider merges — see lib/i18n/client.js). `status`
 * carries the shared moderation/lead/conversation vocabularies, and
 * `listings` the property-type words the moderation screens render; nothing
 * here reaches a public visitor's payload.
 */
const ADMIN_NAMESPACES = ['admin', 'status', 'listings'];

/**
 * Internal tool, not part of the public site's nav (Header.js has no link
 * here on purpose). Gated by middleware.js + lib/adminAuth.js's session
 * cookie — a single shared team password, not per-agent accounts. This
 * layout also wraps /admin/login itself (Next.js layout nesting has no
 * built-in opt-out short of moving that route to a separate part of the
 * tree), so the nav/logout showing there is a harmless cosmetic quirk, not
 * a security concern: every link still passes back through the middleware.
 *
 * Shell now matches web/Design's admin screen: a royal `AdminSidebar` rail
 * beside a chalk content column with its own white 76px page header. The
 * sidebar is `hidden lg:flex` — the design only specifies a desktop
 * console, and a 248px rail would eat most of a phone viewport, so below
 * `lg` the nav collapses into a horizontal scroller under the header
 * rather than disappearing entirely.
 */
export default async function AdminLayout({ children }) {
  const { locale, messages } = await getI18n(ADMIN_NAMESPACES);
  const t = await getT();

  return (
    <I18nProvider locale={locale} messages={messages}>
      <ToastProvider>
      <div className="flex min-h-screen bg-canvas-alt">
        <div className="hidden lg:flex">
          <AdminSidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[76px] shrink-0 items-center gap-5 border-b border-line bg-surface px-6">
            <span className="text-[1.3125rem] font-bold tracking-[-0.008em] text-ink">
              Lukka <span className="text-blue-deep">{t('admin.chrome.brandSuffix')}</span>
            </span>
            {/* The console's language control. `ml-auto` moves here from the
                logout form so the two sit together as one right-hand utility
                cluster, the same shape the public header uses. */}
            <div className="ml-auto flex items-center gap-4">
              <LanguageToggle />
              <form action={logoutAction}>
                <button type="submit" className="text-sm font-medium text-ink-45 transition-colors hover:text-ink">
                  {t('common.actions.logout')}
                </button>
              </form>
            </div>
          </header>

          {/* Below lg the royal rail is hidden, so the same destinations ride
              here instead — see the layout doc comment. */}
          <div className="lg:hidden">
            <AdminSidebar mobile />
          </div>

          <main className="min-w-0 flex-1 px-6 py-7">{children}</main>
        </div>
      </div>
      </ToastProvider>
    </I18nProvider>
  );
}
