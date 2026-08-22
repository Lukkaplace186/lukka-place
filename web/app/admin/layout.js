import Link from 'next/link';
import { logoutAction } from './actions';

export const metadata = {
  title: 'Admin — Lukka Place',
  robots: { index: false, follow: false },
};

/**
 * Internal tool, not part of the public site's nav (Header.js has no link
 * here on purpose). Gated by middleware.js + lib/adminAuth.js's session
 * cookie — a single shared team password, not per-agent accounts. This
 * layout also wraps /admin/login itself (Next.js layout nesting has no
 * built-in opt-out short of moving that route to a separate part of the
 * tree), so the nav/logout showing there is a harmless cosmetic quirk, not
 * a security concern: every link still passes back through the middleware.
 */
export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen bg-canvas-alt">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/admin/conversations" className="text-sm font-bold tracking-tight text-ink">
              Lukka <span className="text-blue-deep">Admin</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium text-ink-70">
              <Link href="/admin/conversations" className="hover:text-blue-deep">
                Conversations
              </Link>
              <Link href="/admin/leads" className="hover:text-blue-deep">
                Prospects
              </Link>
              <a
                href="https://admin.lukkaplace.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-blue-deep"
              >
                Gestion des Biens / CMS ↗
              </a>
            </nav>
          </div>

          <form action={logoutAction}>
            <button type="submit" className="text-sm font-medium text-ink-45 hover:text-ink">
              Se déconnecter
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
