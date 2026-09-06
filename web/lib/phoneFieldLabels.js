/**
 * The five strings components/PhoneField.js needs, resolved in one place so
 * the eight call sites can't drift into eight slightly different labels.
 *
 * It lives here rather than beside the component because half those call
 * sites are Server Components (the agent auth pages, /mot-de-passe-oublie):
 * a named export of a `'use client'` module is a client *reference* on the
 * server, not a callable function, so a shared helper has to sit outside
 * that boundary. Pure and dictionary-driven — no `server-only` either.
 *
 * @param {(key: string) => string} t either useT()'s or getT()'s translator
 */
export function phoneFieldLabels(t) {
  return {
    label: t('auth.phoneNumber'),
    placeholder: t('auth.phonePlaceholder'),
    countryLabel: t('auth.countryCode'),
    search: t('auth.searchCountry'),
    empty: t('auth.noCountryFound'),
  };
}
