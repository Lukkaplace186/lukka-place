import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// Password reset reads `auth` in the browser (PasswordInput, the code form);
// the public shell ships only a few `auth` labels since 2026-11-21.
const RESET_NAMESPACES = ['auth'];

export default async function PasswordResetLayout({ children }) {
  const { locale, messages } = await getI18n(RESET_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
