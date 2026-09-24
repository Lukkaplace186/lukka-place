import Link from 'next/link';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { cachedSeoFacets } from '@/lib/listingsCached';
import { seoPath } from '@/lib/seoPages';
import { socialProfiles } from '@/lib/seoSchema';
import { ChevronDown } from 'lucide-react';
import { Wordmark } from './Brand';
import CurrencyToggle from './CurrencyToggle';
import LanguageToggle from './LanguageToggle';
import FooterByPath from './FooterByPath';
import { getT } from '@/lib/i18n/server';

/**
 * Social icons: WhatsApp always; Facebook / Instagram become real links once
 * their URL is set in the environment (lib/seoSchema.js). Previously: only WhatsApp is a real, working link (same central number
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

/*
 * Keys rather than text, for the reason navItems.js records: a module-level
 * constant is evaluated once at import and would freeze whichever language
 * was active then. The commune column built below is the deliberate
 * exception — a commune name is a real place, not UI copy, and Gombe is
 * Gombe in both languages.
 */
const NAV_COLUMNS = [
  {
    titleKey: 'footer.columns.listings',
    links: [
      // The search landing pages (lib/seoPages.js), not /listings filters:
      // a link from every page is what tells Google these pages matter.
      { labelKey: 'footer.links.forSale', href: '/vente' },
      { labelKey: 'footer.links.forRent', href: '/location' },
      { labelKey: 'footer.links.projects', href: '/projets' },
      { labelKey: 'footer.links.developers', href: '/promoteurs' },
    ],
  },
  {
    titleKey: 'footer.columns.brand',
    links: [
      { labelKey: 'footer.links.about', href: '/a-propos' },
      { labelKey: 'footer.links.guides', href: '/guides' },
      { labelKey: 'footer.links.contact', href: '/contact' },
    ],
  },
  /*
   * The account column exists because Header dropped its desktop "Favoris"
   * text link. A SIGNED-IN visitor still reaches both of these from the
   * header (the account dropdown, and the Demandes link beside the currency
   * pill); a signed-out one sees a bare login icon with no dropdown behind
   * it, and would have had no route to /favoris anywhere in the desktop
   * chrome — while still being able to save listings, since favorites are
   * local-only until they have an account (lib/localFavorites.js). Both
   * routes handle the signed-out case themselves (/favoris renders the local
   * list and offers login; /compte/demandes redirects with a `?next=`), so
   * neither link needs a logged-in branch here.
   */
  {
    titleKey: 'footer.columns.account',
    links: [
      { labelKey: 'nav.favorites', href: '/favoris' },
      { labelKey: 'nav.requests', href: '/compte/demandes' },
    ],
  },
];

// The signed-in customer's account (web/CLAUDE.md, "Espace Client") gets the
// compact footer.
const ACCOUNT_FOOTER_PATHS = ['/compte/client'];

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
  const t = await getT();
  // Communes with the most approved listings, each linked to its landing
  // page for whichever transaction it has more of (almost always rentals).
  const facets = await cachedSeoFacets().catch(() => []);
  const byCommune = new Map();
  for (const f of facets) {
    if (!f.commune || f.propertyType === 'parcelle') continue;
    const row = byCommune.get(f.commune) || { commune: f.commune, rent: 0, sale: 0 };
    if (f.purpose === 'rent') row.rent += f.count;
    if (f.purpose === 'sale') row.sale += f.count;
    byCommune.set(f.commune, row);
  }
  const popularCommunes = [...byCommune.values()]
    .sort((a, b) => b.rent + b.sale - (a.rent + a.sale) || a.commune.localeCompare(b.commune))
    .slice(0, 6);
  const social = socialProfiles();
  const columns = popularCommunes.length
    ? [
        NAV_COLUMNS[0],
        {
          titleKey: 'footer.columns.communes',
          // `label` (already-resolved text), not `labelKey`: these are real
          // commune names out of the database, not dictionary entries.
          links: popularCommunes.map(({ commune, rent, sale }) => ({
            label: commune,
            href: seoPath({ transaction: sale > rent ? 'vente' : 'location', commune }) || `/listings?commune=${encodeURIComponent(commune)}`,
          })),
        },
        ...NAV_COLUMNS.slice(1),
      ]
    : NAV_COLUMNS;

  // The opening line of the WhatsApp message follows the visitor's language
  // too — a French greeting from someone browsing in English reads as a
  // template they were never meant to see.
  const whatsappHref = getCentralWhatsAppHref(t('footer.whatsappGreeting'));

  return (
    <footer className="mt-auto border-t border-line bg-canvas-alt">
      {/* Inside the customer's own account the full footer was a second
          navigation (listings, communes, the account links the tab bar
          already carries) plus the "become a partner agency" band — a
          screen and a half of scrolling on a phone below every tab. There
          it is one strip: the two real pages worth reaching from anywhere,
          the display preferences, the copyright. No "Conditions" or
          "Confidentialité" link: neither page exists yet, and a link to a
          404 is worse than none. */}
      <FooterByPath
        prefixes={ACCOUNT_FOOTER_PATHS}
        compact={
          <div className="mx-auto flex max-w-[77.5rem] flex-col gap-4 px-4 py-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <nav aria-label={t('footer.columns.brand')} className="flex items-center gap-4 text-[0.8125rem] font-medium text-ink-70">
              <Link href="/contact" className="transition-colors hover:text-blue-deep">
                {t('footer.links.contact')}
              </Link>
              <span aria-hidden="true" className="text-ink-25">•</span>
              <Link href="/a-propos" className="transition-colors hover:text-blue-deep">
                {t('footer.links.about')}
              </Link>
            </nav>
            <div className="flex flex-wrap items-center gap-2.5">
              <CurrencyToggle />
              <LanguageToggle />
            </div>
            <p className="text-xs text-ink-35">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          </div>
        }
      >
        {/* Agency recruitment band. Sits above the link columns rather than
            inside one — it is a conversion ask, not a navigation item, and it
            is now the only place on a public page that recruits supply: the
            header's filled partner pill and the hero panel's fused royal
            strip are both gone (Header.js, SearchBar.js), so this band
            carries the whole message on its own and is sized like the real
            section it is, not like a footer strip.

            bg-blue (real --blue, royal-600 #1E3AA8 — the token app/globals.css
            already contrast-computes as "white text on --blue ... 7.9:1 AAA"),
            not the previous bg-ink near-black. Royal blue is this design's one
            voice of action, so the page's single supply-side conversion ask now
            wears the brand colour instead of reading as a neutral dark slab.
            Not the raw #233B93 from the brief: that is a hand-picked hex a few
            points off the token every other blue surface on the site already
            uses (the hero CTA, the primary buttons), and two royal blues that
            nearly match is worse than one that does.

            border-white/15 replaces border-line here specifically — border-line
            is tuned for hairlines on light surfaces and is invisible against a
            saturated royal fill. Subtext is white/80, not white/70: on royal
            blue that composites to 6.6:1 (white/70 drops to ~5.2:1), so the
            second line clears AA on its own rather than borrowing the heading's
            contrast.

            The button reverts from the brass "metallic ghost" to a solid white
            fill with royal text — the highest-contrast pairing available on this
            background (7.9:1, the same ratio inverted), and brass-on-royal would
            have put the one accent reserved for prestige marks onto a button,
            which Readme.md forbids outright. Hover goes to --blue-tint (#EEF2FF,
            the real token behind what the brief called blue-50).

            Mobile: the band is a flex row that wraps, so below sm the button
            landed at its natural ~210px width, left-aligned under the copy and
            reading as a link rather than the section's action. It is now
            full-width and centred until sm, at h-12 (48px, the documented tap
            target), which is the only real CTA treatment on a stacked layout. */}
        <div className="border-y border-white/15 bg-blue">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-6 px-4 py-9 sm:px-6 sm:py-12 lg:px-8 lg:py-16">
            <div className="min-w-0 max-w-[40rem]">
              <p className="font-display text-[1.375rem] leading-[1.2] tracking-[0.1px] text-white sm:text-2xl">
                {t('footer.partnerBand.title')}
              </p>
              <p className="mt-2.5 text-[1.0625rem] leading-[1.56] text-white/80">
                {t('footer.partnerBand.subtitle')}
              </p>
            </div>
            <Link
              href="/compte/agent/inscription"
              className="u-press inline-flex h-12 w-full flex-none items-center justify-center rounded-lg bg-white px-6 text-[0.9375rem] font-bold text-blue transition-colors hover:bg-blue-tint sm:w-auto"
            >
              {t('footer.partnerBand.cta')}
            </Link>
          </div>
        </div>

        {/* pb-28 below md: FloatingControlBar (Carte / Trier / Alerte) and
            MobileListingBar are fixed to the bottom of a phone screen, and
            without the extra room they sat over the disclaimer and the
            copyright line — the last things on the page. */}
        <div className="mx-auto max-w-[1600px] px-4 pb-28 pt-10 sm:px-6 sm:pt-14 md:pb-14 lg:px-8 lg:py-16">
          {/* Six, not five. The brand block below spans two, so five left
              exactly three slots for link columns — which was right for
              Annonces + Communes + Lukka Place and wraps the moment there is a
              fourth (the Compte column added above). At six, the full set fits
              one row and the communes-less case simply leaves the last slot
              empty rather than dropping a column onto its own line. Staying
              within 1-6 is deliberate: web/CLAUDE.md records a `lg:grid-cols-10`
              that silently never made it into the compiled CSS. */}
          <div className="grid grid-cols-1 md:grid-cols-2 md:gap-10 lg:grid-cols-6">
            <div className="border-b border-line pb-6 md:border-b-0 md:pb-0 lg:col-span-2">
              <Wordmark />
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-45">
                {t('footer.tagline')}
              </p>
              <div className="mt-5 flex items-center gap-3">
                {whatsappHref ? (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('admin.leads.whatsapp')}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-green text-white transition-colors hover:bg-green-deep"
                  >
                    <WhatsAppIcon className="h-4.5 w-4.5" />
                  </a>
                ) : (
                  <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas-deep text-ink-25">
                    <WhatsAppIcon className="h-4.5 w-4.5" />
                  </span>
                )}
                {/* Live links once NEXT_PUBLIC_FACEBOOK_URL / _INSTAGRAM_URL are
                    set (lib/seoSchema.js socialProfiles); inert until then. */}
                {[
                  ['facebook', 'Facebook', <FacebookIcon key="i" className="h-4 w-4" />],
                  ['instagram', 'Instagram', <InstagramIcon key="i" className="h-4 w-4" />],
                ].map(([key, name, icon]) =>
                  social[key] ? (
                    <a
                      key={key}
                      href={social[key]}
                      target="_blank"
                      rel="noopener noreferrer me"
                      aria-label={name}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white transition-colors hover:bg-blue-deep"
                    >
                      {icon}
                    </a>
                  ) : (
                    <span key={key} aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas-deep text-ink-25">
                      {icon}
                    </span>
                  ),
                )}
              </div>
            </div>

            {columns.map(({ titleKey, links }) => {
              const list = (
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-1 md:gap-y-2">
                  {links.map(({ label, labelKey, href }) => (
                    <li key={href} className="min-w-0">
                      <Link href={href} className="block truncate py-1 text-sm text-ink-70 transition-colors hover:text-blue-deep md:py-0">
                        {labelKey ? t(labelKey) : label}
                      </Link>
                    </li>
                  ))}
                </ul>
              );
              return (
                <div key={titleKey}>
                  {/* Below md each group is a native <details> accordion,
                      closed by default: four open groups were a screen of
                      links a phone visitor had to scroll past to reach the
                      disclaimer. No JavaScript — this stays a Server
                      Component, and the links are in the HTML either way.
                      From md the groups are ordinary open columns; the list is
                      rendered twice rather than forcing a <details> open with
                      CSS, which browsers do not honour for closed content. */}
                  <details className="u-accordion group border-b border-line md:hidden">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden">
                      <span className="u-eyebrow">{t(titleKey)}</span>
                      <ChevronDown
                        aria-hidden="true"
                        className="h-4 w-4 text-ink-45 transition-transform duration-200 group-open:rotate-180"
                      />
                    </summary>
                    <div className="pb-3">{list}</div>
                  </details>
                  <div className="hidden md:block">
                    <h3 className="u-eyebrow mb-3">{t(titleKey)}</h3>
                    {list}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Display preferences. The currency control's second home now that
              it no longer rides in the mobile navbar (Header.js) — reachable
              from the bottom of any page, and labelled, which the bare
              "$ | FC" header pill never was. */}
          {/* Phone: one compact row, each control under its own label, with
              the short "$ | FC" / "FR | EN" labels — the long ones wrapped
              into two stacked full-width rows at 375px. md and up keep the
              labelled inline row. */}
          <div className="mt-6 grid grid-cols-2 gap-4 md:hidden">
            <div className="flex flex-col items-start gap-2">
              <span className="u-eyebrow">{t('common.currency.label')}</span>
              <CurrencyToggle />
            </div>
            <div className="flex flex-col items-start gap-2">
              <span className="u-eyebrow">{t('common.language.label')}</span>
              <LanguageToggle />
            </div>
          </div>
          <div className="mt-9 hidden flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-6 md:flex">
            <span className="u-eyebrow">{t('common.currency.label')}</span>
            <CurrencyToggle longLabels />

            {/* The language control's third home, alongside the currency one.
                Both are reachable from the bottom of any page at any scroll
                depth without riding in the header on mobile — see Header.js. */}
            <span className="u-eyebrow ml-2">{t('common.language.label')}</span>
            <LanguageToggle longLabels />
          </div>

          <div className="mt-6 border-t border-line pt-6 md:mt-8">
            <p className="max-w-4xl text-xs leading-relaxed text-ink-45">{t('footer.disclaimer')}</p>
            <p className="mt-4 text-xs text-ink-25">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </FooterByPath>
    </footer>
  );
}
