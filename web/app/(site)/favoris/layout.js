import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// /favoris reads `account.favorites.*` / `account.alerts.*` in the browser; the
// namespace left the public shell on 2026-11-21 (see app/(site)/layout.js).
const FAVORIS_NAMESPACES = ['account', 'auth'];

export default async function FavorisLayout({ children }) {
  const { locale, messages } = await getI18n(FAVORIS_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
