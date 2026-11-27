import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

/*
 * The account pages (sign-in, sign-up, Espace Client, the agent sign-up under
 * (site)) read most of `account` and `auth` in the browser. Those two
 * namespaces left the public shell on 2026-11-21 (app/(site)/layout.js ships
 * only a few subtrees of them), so they ship whole from here. I18nProvider
 * merges, so the shell's namespaces are still available below.
 */
const COMPTE_NAMESPACES = ['account', 'auth', 'chat'];

export default async function CompteLayout({ children }) {
  const { locale, messages } = await getI18n(COMPTE_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
