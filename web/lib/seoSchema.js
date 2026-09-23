import { SITE_URL } from './constants';

/**
 * schema.org building blocks shared across pages. Every value is either a
 * real Lukka Place fact or read from the environment — a social profile that
 * does not exist yet is simply absent, never a guessed URL.
 */

const base = () => SITE_URL.replace(/\/+$/, '');

export const ORG_LOGO_PATH = '/brand/icon-square-512.png';

/**
 * Official social profiles, set in `.env.local` once the accounts exist:
 * NEXT_PUBLIC_FACEBOOK_URL, NEXT_PUBLIC_INSTAGRAM_URL, NEXT_PUBLIC_TIKTOK_URL,
 * NEXT_PUBLIC_LINKEDIN_URL. The footer links them and the Organization schema
 * lists them as `sameAs`, which is how Google ties the profiles to the site.
 */
export function socialProfiles() {
  const entries = [
    ['facebook', process.env.NEXT_PUBLIC_FACEBOOK_URL],
    ['instagram', process.env.NEXT_PUBLIC_INSTAGRAM_URL],
    ['tiktok', process.env.NEXT_PUBLIC_TIKTOK_URL],
    ['linkedin', process.env.NEXT_PUBLIC_LINKEDIN_URL],
  ];
  return Object.fromEntries(entries.filter(([, url]) => typeof url === 'string' && /^https:\/\//.test(url.trim())).map(([k, url]) => [k, url.trim()]));
}

export function organizationSchema() {
  const url = base();
  const phone = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const sameAs = Object.values(socialProfiles());
  return {
    '@type': 'RealEstateAgent',
    '@id': `${url}/#organization`,
    name: 'Lukka Place',
    url,
    logo: `${url}${ORG_LOGO_PATH}`,
    image: `${url}/og-image.png?v=2`,
    areaServed: { '@type': 'City', name: 'Kinshasa', address: { '@type': 'PostalAddress', addressLocality: 'Kinshasa', addressCountry: 'CD' } },
    address: { '@type': 'PostalAddress', addressLocality: 'Kinshasa', addressCountry: 'CD' },
    ...(phone ? { telephone: `+${String(phone).replace(/\D/g, '')}` } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

/** WebSite + sitelinks search box: a Google search can land straight on /listings?q=… */
export function websiteSchema() {
  const url = base();
  return {
    '@type': 'WebSite',
    '@id': `${url}/#website`,
    name: 'Lukka Place',
    url,
    inLanguage: 'fr',
    publisher: { '@id': `${url}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${url}/listings?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}
