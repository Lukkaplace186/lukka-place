import { notFound } from 'next/navigation';
import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

/**
 * The /app-demo board's wording (it sits outside the site layout): what the
 * app components on it read. Local only, like the page: a production build
 * answers 404 here too.
 */
export default async function AppDemoLayout({ children }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { locale, messages } = await getI18n(['chat', 'appShell', 'listings']);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
