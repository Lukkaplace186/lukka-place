import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';
import { redirect } from 'next/navigation';
import { getFeatureFlags } from '@/lib/siteSettings';

/*
 * /projets is the only public subtree whose client components (ProjectsMap,
 * PortionSelector, LotPlan, PaymentPlan) read the `projects` namespace, so it
 * ships here instead of in (site)'s layout — ~11 KB of copy every other public
 * page no longer carries. Server components elsewhere (NewProjectsStrip,
 * ProjectUnitStrip, /promoteurs) use getT(), which holds the whole dictionary.
 * I18nProvider merges, so the site's namespaces are still available here.
 */
const PROJECT_NAMESPACES = ['projects'];

// While hidden the redirect below runs inside (site)'s loading.js Suspense, so it
// reaches the browser as a client hop on a 200 — the page tells crawlers not to index it.
export async function generateMetadata() {
  return (await getFeatureFlags()).publicProjects ? {} : { robots: { index: false, follow: false } };
}

export default async function ProjectsLayout({ children }) {
  // Projets neufs switched off on /admin/settings: every /projets page sends
  // the visitor to the listings instead (a temporary redirect, not a 404).
  if (!(await getFeatureFlags()).publicProjects) redirect('/listings');
  const { locale, messages } = await getI18n(PROJECT_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
