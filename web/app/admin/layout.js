import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { logoutAction } from './actions';
import AdminSidebar from './AdminSidebar';
import GlobalSearch from './GlobalSearch';
import LanguageToggle from '@/components/LanguageToggle';
import { ToastProvider } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { can, ROLE_LABEL_KEYS, sectionPermission } from '@/lib/adminRoles';
import { getAdminPathname, getAdminSession } from '@/lib/adminSession';
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
// `errors` too: the console's client-side actions fall back to its generic
// "action failed" copy when a server action throws.
const ADMIN_NAMESPACES = ['admin', 'status', 'listings', 'errors'];

const PUBLIC_PATHS = ['/admin/login', '/admin/activate'];

/**
 * Internal tool, not part of the public site's nav. Three gates, in order:
 *
 * 1. middleware.js — the session cookie is signed by us and unexpired.
 * 2. HERE — the account behind it still exists, is active, and has not had its
 *    access reset (lib/adminSession.js). A disabled person's still-valid cookie
 *    stops working on their next click, not at its 12h expiry.
 * 3. HERE — their ROLE may open this section (lib/adminRoles.js). Server
 *    Actions don't pass through a layout, so each also calls requireAdmin().
 *
 * The login and activation pages render bare, without the console chrome.
 */
export default async function AdminLayout({ children }) {
  const { locale, messages } = await getI18n(ADMIN_NAMESPACES);
  const t = await getT();
  const pathname = await getAdminPathname();
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (isPublic) {
    return (
      <I18nProvider locale={locale} messages={messages}>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    );
  }

  const session = await getAdminSession();
  if (!session) redirect(`/admin/login?error=revoked&next=${encodeURIComponent(pathname || '/admin/dashboard')}`);

  const required = sectionPermission(pathname);
  const forbidden = required && !can(session.role, required);

  return (
    <I18nProvider locale={locale} messages={messages}>
      <ToastProvider>
      <div className="flex min-h-screen bg-canvas-alt">
        <div className="hidden lg:flex">
          <AdminSidebar role={session.role} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[76px] shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
            <Link href="/admin/dashboard" className="hidden text-[1.3125rem] font-bold tracking-[-0.008em] text-ink sm:inline">
              Lukka <span className="text-blue-deep">{t('admin.chrome.brandSuffix')}</span>
            </Link>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-4">
              <LanguageToggle />
              <div className="hidden text-right leading-tight md:block">
                <div className="text-sm font-semibold text-ink">{session.shared ? t('admin.chrome.sharedSession') : session.name}</div>
                <div className="text-xs text-ink-45">{t(ROLE_LABEL_KEYS[session.role])}</div>
              </div>
              <form action={logoutAction}>
                <button type="submit" className="text-sm font-medium text-ink-45 transition-colors hover:text-ink">
                  {t('common.actions.logout')}
                </button>
              </form>
            </div>
          </header>

          {session.shared ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning-tint px-6 py-2 text-sm text-ink-70">
              <ShieldAlert strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-warning" />
              <span>{t('admin.chrome.sharedBanner')}</span>
              <Link href="/admin/team" className="font-semibold text-blue-deep hover:underline">{t('admin.chrome.sharedBannerLink')}</Link>
            </div>
          ) : null}

          {/* Below lg the royal rail is hidden, so the same destinations ride
              here instead. */}
          <div className="lg:hidden">
            <AdminSidebar mobile role={session.role} />
          </div>

          <main className="min-w-0 flex-1 px-6 py-7">
            {forbidden ? (
              <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-16 text-center">
                <ShieldAlert strokeWidth={ICON_STROKE_WIDTH} className="h-10 w-10 text-warning" />
                <h1 className="u-title-section text-ink">{t('admin.chrome.forbiddenTitle')}</h1>
                <p className="u-micro text-ink-70">{t('admin.chrome.forbiddenBody', { role: t(ROLE_LABEL_KEYS[session.role]) })}</p>
                <Link href="/admin/dashboard" className="u-micro-strong text-blue-deep hover:underline">{t('admin.errorBoundary.home')}</Link>
              </div>
            ) : children}
          </main>
        </div>
      </div>
      </ToastProvider>
    </I18nProvider>
  );
}
