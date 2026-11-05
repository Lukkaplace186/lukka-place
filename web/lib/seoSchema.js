import { SITE_URL } from './constants';
import { CITIES } from './cities';

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

/**
 * Profile URLs for `sameAs`: the console's saved links (/admin/settings) over
 * the env ones, never the WhatsApp link (a chat, not a profile), and without
 * their query string — the saved Instagram/TikTok links carry share-tracking
 * parameters ("?utm_source=qr", "?_r=1&_t=…") that are not the profile's
 * address. Until 2026-11-05 only the env ones were read, so the profiles the
 * footer showed never reached Google.
 */
export function sameAsProfiles(links = socialProfiles()) {
  const out = [];
  for (const [network, value] of Object.entries(links || {})) {
    if (network === 'whatsapp' || typeof value !== 'string') continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:') continue;
      url.search = '';
      url.hash = '';
      const clean = url.toString().replace(/\/$/, '');
      if (!out.includes(clean)) out.push(clean);
    } catch {
      // not a URL — left out
    }
  }
  return out;
}

export function organizationSchema({ profiles } = {}) {
  const url = base();
  const phone = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const sameAs = sameAsProfiles(profiles || socialProfiles());
  return {
    '@type': 'RealEstateAgent',
    '@id': `${url}/#organization`,
    name: 'Lukka Place',
    url,
    logo: `${url}${ORG_LOGO_PATH}`,
    image: `${url}/og-image.png?v=2`,
    // Every city covered (lib/cities.js), in the DRC; the office stays Kinshasa.
    areaServed: [
      { '@type': 'Country', name: 'République démocratique du Congo' },
      ...CITIES.map((city) => ({ '@type': 'City', name: city.name, address: { '@type': 'PostalAddress', addressLocality: city.name, addressCountry: 'CD' } })),
    ],
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
