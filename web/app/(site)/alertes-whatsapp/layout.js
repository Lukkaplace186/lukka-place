import { getI18n } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/client';

// The alert picker's labels (components/HomeAlertPicker.js): the site shell
// ships only part of `home`, and the homepage's own layout is not above this
// page. Without this the picker printed its keys.
const ALERT_PAGE_NAMESPACES = ['home.alertBand'];

export default async function AlertLandingLayout({ children }) {
  const { locale, messages } = await getI18n(ALERT_PAGE_NAMESPACES);
  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
    </I18nProvider>
  );
}
