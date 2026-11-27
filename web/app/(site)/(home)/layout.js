import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// The homepage's own copy (hero, alert band, market explorer, rails) ships
// from here since 2026-11-21 instead of with every public page; the shell
// keeps only the `home.search.*` labels /listings' quick filters share.
const HOME_NAMESPACES = ['home'];

export default async function HomeLayout({ children }) {
  const { locale, messages } = await getI18n(HOME_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
