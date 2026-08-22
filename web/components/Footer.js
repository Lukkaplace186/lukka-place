import Link from 'next/link';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { getPopularCommunes } from '@/lib/listings';
import { Wordmark } from './Brand';

/**
 * Social icons: only WhatsApp is a real, working link (same central number
 * used everywhere else — see CLAUDE.md's Lead Routing Rules). Facebook/
 * Instagram/LinkedIn have no real Lukka Place accounts to link to yet, so
 * they render as inert placeholders (not <a> tags — a fake href pointing
 * nowhere is worse than an icon that's honestly not clickable) rather than
 * invented URLs.
 *
 * All three stay hand-rolled brand SVGs — this lucide-react version ships no
 * brand/logo glyphs at all (Facebook/Instagram/WhatsApp import errors:
 * "Export ... doesn't exist in target module" — confirmed by a failed build,
 * not assumed), so brand marks are the one deliberate exception to
 * "icons are lucide-react".
 */
function WhatsAppIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.13c-.24.68-1.4 1.3-1.93 1.38-.5.08-1.12.11-1.8-.11-.42-.13-.95-.3-1.64-.6-2.88-1.24-4.76-4.14-4.9-4.33-.14-.19-1.17-1.56-1.17-2.98s.73-2.11 1-2.4c.26-.29.57-.36.76-.36h.55c.18 0 .42-.07.65.5.24.58.81 2 .88 2.14.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.28.36-.23.6-.14.24.09 1.55.73 1.81.86.26.14.44.2.5.31.07.12.07.68-.17 1.35z" />
    </svg>
  );
}
function FacebookIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M13.5 21v-7.5H16l.5-3H13.5V8.5c0-.9.3-1.5 1.6-1.5H16.5V4.3C16.2 4.3 15.2 4.2 14 4.2c-2.4 0-4 1.5-4 4.1V10.5H7.5v3H10V21h3.5Z" />
    </svg>
  );
}
function InstagramIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const NAV_COLUMNS = [
  {
    title: 'Annonces',
    links: [
      { label: 'À vendre', href: '/listings?transaction_type=vente' },
      { label: 'À louer', href: '/listings?transaction_type=location' },
    ],
  },
  {
    title: 'Lukka Place',
    links: [
      { label: 'À propos', href: '/a-propos' },
      { label: 'Contact', href: '/contact' },
    ],
  },
];

const LEGAL_DISCLAIMER =
  "Lukka Place est une plateforme d'annonces immobilières à Kinshasa. Les informations fournies sur les annonces sont établies sous la responsabilité des annonceurs. Lukka Place ne fournit pas de services de courtage financier direct et facilite la mise en relation via référence d'annonce.";

/**
 * The commune column is built from communes that actually have approved
 * listings, and is omitted entirely when none do.
 *
 * It used to be a hardcoded list of four (Gombe, Ngaliema, Bandalungwa,
 * Kintambo). No approved listing currently carries a commune tag at all, so
 * every one of those links led to a "0 résultats" page — a footer full of
 * dead ends. Same principle as the property-type filter: never offer a
 * destination the data can't fill.
 */
export default async function Footer() {
  const popularCommunes = await getPopularCommunes(5);
  const columns = popularCommunes.length
    ? [
        NAV_COLUMNS[0],
        {
          title: 'Communes',
          links: popularCommunes.map(({ commune }) => ({
            label: commune,
            href: `/listings?commune=${encodeURIComponent(commune)}`,
          })),
        },
        ...NAV_COLUMNS.slice(1),
      ]
    : NAV_COLUMNS;

  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const whatsappHref = phoneNumber
    ? buildWhatsAppLink(phoneNumber, 'Bonjour, je vous contacte depuis lukkaplace.com.')
    : null;

  return (
    <footer className="mt-auto border-t border-line bg-canvas-alt">
      <div className="mx-auto max-w-[1600px] px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-45">
              La plateforme d&apos;annonces immobilières de Kinshasa — appartements, villas et parcelles, à louer ou à vendre.
            </p>
            <div className="mt-5 flex items-center gap-3">
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="WhatsApp"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-green text-white transition-colors hover:bg-green-deep"
                >
                  <WhatsAppIcon className="h-4.5 w-4.5" />
                </a>
              ) : (
                <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas-deep text-ink-25">
                  <WhatsAppIcon className="h-4.5 w-4.5" />
                </span>
              )}
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas-deep text-ink-25">
                <FacebookIcon className="h-4 w-4" />
              </span>
              <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas-deep text-ink-25">
                <InstagramIcon className="h-4 w-4" />
              </span>
            </div>
          </div>

          {columns.map(({ title, links }) => (
            <div key={title}>
              <h3 className="u-eyebrow mb-4">{title}</h3>
              <ul className="flex flex-col gap-2">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link href={href} className="text-sm text-ink-70 transition-colors hover:text-blue-deep">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-7">
          <p className="max-w-4xl text-xs leading-relaxed text-ink-45">{LEGAL_DISCLAIMER}</p>
          <p className="mt-4 text-xs text-ink-25">&copy; {new Date().getFullYear()} Lukka Place — Kinshasa, RDC.</p>
        </div>
      </div>
    </footer>
  );
}
