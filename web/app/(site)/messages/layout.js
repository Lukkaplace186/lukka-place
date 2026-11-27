import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// The Messagerie reads all of `chat` in the browser; the public shell ships
// only two of its labels since 2026-11-21 (see app/(site)/layout.js).
const MESSAGES_NAMESPACES = ['chat', 'auth'];

export default async function MessagesLayout({ children }) {
  const { locale, messages } = await getI18n(MESSAGES_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
