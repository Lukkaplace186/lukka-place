import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

/*
 * /projets is the only public subtree whose client components (ProjectsMap,
 * PortionSelector, LotPlan, PaymentPlan) read the `projects` namespace, so it
 * ships here instead of in (site)'s layout — ~11 KB of copy every other public
 * page no longer carries. Server components elsewhere (NewProjectsStrip,
 * ProjectUnitStrip, /promoteurs) use getT(), which holds the whole dictionary.
 * I18nProvider merges, so the site's namespaces are still available here.
 */
const PROJECT_NAMESPACES = ['projects'];

export default async function ProjectsLayout({ children }) {
  const { locale, messages } = await getI18n(PROJECT_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
