'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from '@/components/IntentLink';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, Search, User, ArrowRight, Mail } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { Wordmark } from './Brand';
import CurrencyToggle from './CurrencyToggle';
import LanguageToggle from './LanguageToggle';
import { useLocale, useT } from '@/lib/i18n/client';
import { frenchPathOf, localizeHref } from '@/lib/localePaths';
import { useIsLoggedIn, useIsAgentSignedIn } from '@/lib/customerClient';
import { useChatUnread, useUnreadTitle } from '@/lib/useChatUnread';
import UnreadBadge from './chat/UnreadBadge';
import { OPEN_SITE_MENU_EVENT } from '@/lib/siteMenu';

/*
 * The phone drawer and the signed-in account dropdown load on demand
 * (2026-11-21, public JS diet): together with the Radix Dialog / DropdownMenu
 * / Popper stack and tailwind-merge they were ~30 KB gzip of every public
 * page's JavaScript, for a menu most visitors never open (and desktop never
 * shows). The drawer's chunk starts loading when the ☰ is hovered, focused
 * or touched, so it is usually there by the time the tap lands.
 * tests/unit/public-js-diet.test.js keeps Radix out of this file.
 */
const loadDrawer = () => import('./HeaderDrawer');
const HeaderDrawer = dynamic(loadDrawer, { ssr: false });
const loadAccountMenu = () => import('./HeaderAccountMenu');

const ACCOUNT_BUTTON_CLASS =
  'relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-70 transition-colors hover:border-blue hover:text-blue-deep';

/**
 * The four nav destinations of the "Landing refondue" header.
 *
 * Louer and Acheter were promoted *out* of the hero search panel and into
 * the nav, so the two audiences separate before the search unit rather than
 * inside it. SearchBar.js's tab row is Louer/Acheter only now, and it lost
 * its "Agents" tab entirely — a directory is not a property type, so it
 * never belonged in a row that switches what you search. "Agences" is where
 * that directory lives instead.
 *
 * No active-state underline here, unlike the mockup: two of these four
 * destinations used to be distinguished only by a query string
 * (?transaction_type=...), and reading that from a layout-level client
 * component means useSearchParams(), which drags every statically rendered
 * route under this layout into a Suspense bailout (see web/CLAUDE.md).
 * Hover colour only, rather than an underline that would be right on two
 * links and silently wrong on the other two.
 */
// Louer / Acheter open the /location and /vente landing pages (2026-10-24,
// SEO): the links every page carries are the strongest internal links a site
// has, and /listings?transaction_type=… only names those pages as canonical.
// Both landing pages lead on to the full search and the map.
const PRIMARY_LINKS = [
  { href: '/location', labelKey: 'nav.rent' },
  { href: '/vente', labelKey: 'nav.buy' },
  // New developments and land in lots — their own hub and map (/projets).
  { href: '/projets', labelKey: 'nav.projects' },
  // Guides & Actualités, only while /admin/settings' publicBlog is on
  // (app/(site)/layout.js hides it otherwise).
  { href: '/guides', labelKey: 'nav.blog' },
  { href: '/a-propos', labelKey: 'nav.about' },
  // The agent directory (search by name, city, commune; app/(portfolio)/agents)
  // as "Agences", directly under À propos (2026-10-27, owner) — last in the
  // bar, and in the drawer the row just above Favoris. The route stays
  // /agents: that is where the directory and every agent profile live.
  { href: '/agents', labelKey: 'nav.agencies' },
];

const DRAWER_PRIMARY_LINKS = PRIMARY_LINKS;

/**
 * Sticky site header.
 *
 * Solid on every route, the homepage included. It previously started
 * transparent over the hero photograph and solidified on scroll — a
 * rAF-throttled scroll listener driving an `overHero` flag through nine
 * separate className branches. The refonte is explicit that it never goes
 * transparent, because the wordmark has to stay legible over whatever
 * photograph the hero happens to be carrying. The listener, the `scrolled`
 * state and every inverted variant are gone with it, and Hero.js no longer
 * bleeds up under the header either.
 *
 * The header CTA is "Publier un bien" as a secondary outline button, not
 * the filled "Devenir Agence Partenaire" pill it used to be. One filled
 * royal button per band, and on the homepage that one is "Rechercher"; the
 * partner ask keeps its own royal band above the footer (Footer.js), which
 * is the single place on a public page that recruits supply.
 *
 * Height is 4rem/h-16 and is depended on elsewhere: FilterBar sticks at
 * `top-16` so the two never overlap.
 *
 * Fill is `bg-surface` (the real `--surface` token, `#fff` — solid white,
 * not the `bg-canvas/90 backdrop-blur-md` translucent-over-scroll-content
 * treatment this carried before) with a real `shadow-sm` elevation instead
 * of relying on the 1px hairline alone to separate it from the page.
 * Position stays `fixed` rather than `position: sticky` — `fixed` already
 * delivers "always visible while scrolling" on every route without
 * depending on being a scroll-container's first child (SiteShell's `pt-16`
 * spacer already accounts for it), and switching would be a structural
 * change for the same visible result. `z-[60]` used to matter specifically
 * against BottomNav.js's `z-50` fixed tab bar (mounted after Header in the
 * tree, so a tied z-index would have let it paint over the header on
 * mobile); that bar is gone entirely now (see app/(site)/layout.js), but
 * `z-[60]` is left as-is — still correct, and nothing left in the public
 * site tree needs Header to sit any lower.
 *
 * **Desktop utility row, left to right**: search icon (only where nothing
 * else on the page owns search), account, currency, Demandes, language,
 * "Publier un bien". Two deliberate changes from the previous order:
 *
 *   - **Favoris is no longer a text link here.** It sat between the
 *     currency pill and Demandes, which made the row read as three
 *     unrelated things wearing the same weight. Favorites did not lose a
 *     home — "Mes favoris" is in the account dropdown right of the wordmark,
 *     the mobile drawer carries it in both session states, and the footer's
 *     Compte column now lists it too, which is what keeps /favoris reachable
 *     on desktop for a SIGNED-OUT visitor: favorites are local-only for
 *     them (lib/localFavorites.js), and the account affordance they see is a
 *     login link with no dropdown to hold it.
 *   - **Demandes moved up beside the currency toggle**, and the language
 *     control moved down to sit immediately before the CTA. Each block below
 *     carries its own note on why.
 *
 * Demandes still routes to the same `/compte/demandes` the mobile tab bar
 * always used. It used to live only on the fixed left icon rail
 * (SideRail.js), which had no desktop equivalent anywhere else; that rail is
 * gone entirely (see app/(site)/layout.js), so every page under this layout
 * gets its full container width back instead of losing 76px to a gutter.
 */
export default function Header({ hiddenHrefs = [] }) {
  // Sections switched off on /admin/settings (Projets neufs) leave the bar and the drawer.
  const primaryLinks = PRIMARY_LINKS.filter(({ href }) => !hiddenHrefs.includes(href));
  const drawerLinks = DRAWER_PRIMARY_LINKS.filter(({ href }) => !hiddenHrefs.includes(href));
  // On an English page (/en/…) compare against the French path the links are written in.
  const rawPathname = usePathname() || '/';
  const pathname = frenchPathOf(rawPathname) || rawPathname;
  const locale = useLocale();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // The drawer is mounted from its first opening on, then stays mounted (its
  // exit animation and the next opening need it).
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [AccountMenu, setAccountMenu] = useState(null);
  const menuButtonRef = useRef(null);
  const loggedIn = useIsLoggedIn();
  const agentSignedIn = useIsAgentSignedIn();
  const t = useT();
  // Messagerie: the signed-in customer's unread chat messages, live
  // (lib/useChatUnread.js) — on the account icon, beside "Messages" in both
  // menus, and as "(3) …" in the tab title. Nothing is asked when signed out.
  const unread = useChatUnread('customer', { enabled: loggedIn });
  useUnreadTitle(unread);
  const unreadText = t('chat.inbox.unreadLabel', { count: unread });

  // Warm the three site destinations the moment the drawer opens, so the page
  // is usually already in the router cache by the time a row is tapped. The
  // Links inside would prefetch on their own once visible, but only after the
  // portal mounts; this starts during the slide. No-op in dev.
  const handleMenuOpenChange = (open) => {
    setMenuOpen(open);
    if (open) {
      setDrawerMounted(true);
      drawerLinks.forEach(({ href }) => router.prefetch(localizeHref(href, locale)));
    }
  };

  // The phone map hides this bar and carries its own ☰ in its glass header
  // (MobileMapChrome, lib/siteMenu.js); that button opens this same drawer.
  useEffect(() => {
    const open = () => {
      setDrawerMounted(true);
      setMenuOpen(true);
    };
    window.addEventListener(OPEN_SITE_MENU_EVENT, open);
    return () => window.removeEventListener(OPEN_SITE_MENU_EVENT, open);
  }, []);

  // Signed in: fetch the account dropdown; a look-alike button stands in
  // until it arrives (one round trip, right after hydration).
  useEffect(() => {
    if (!loggedIn || AccountMenu) return;
    let live = true;
    loadAccountMenu()
      .then((mod) => { if (live) setAccountMenu(() => mod.default); })
      .catch(() => {});
    return () => { live = false; };
  }, [loggedIn, AccountMenu]);

  // Warm the drawer's chunk on intent; a failed fetch is retried by the tap.
  const warmDrawer = () => { loadDrawer().catch(() => {}); };

  return (
    <header data-site-header className="u-header-elevate fixed inset-x-0 top-0 z-[60] h-16 border-b border-line bg-surface shadow-sm">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:gap-3 lg:px-6 xl:gap-4 xl:px-8">
        <div className="flex items-center gap-3 lg:hidden xl:flex xl:w-[76px] xl:shrink-0 xl:pl-0">
          {/* Mobile menu. A plain button: the drawer (components/HeaderDrawer.js,
              Radix Sheet — it owns focus trapping, Escape and outside-click)
              is fetched on hover / focus / touch and mounted on first open. */}
          <button
            ref={menuButtonRef}
            type="button"
            aria-label={t('nav.openMenu')}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onPointerEnter={warmDrawer}
            onPointerDown={warmDrawer}
            onFocus={warmDrawer}
            onClick={() => handleMenuOpenChange(true)}
            className="flex h-11 w-11 items-center justify-center rounded-md text-ink transition-colors hover:bg-canvas-deep lg:hidden"
          >
            <Menu strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7" />
          </button>
          {drawerMounted ? (
            <HeaderDrawer
              open={menuOpen}
              onOpenChange={handleMenuOpenChange}
              drawerLinks={drawerLinks}
              pathname={pathname}
              loggedIn={loggedIn}
              agentSignedIn={agentSignedIn}
              unread={unread}
              returnFocusRef={menuButtonRef}
            />
          ) : null}
        </div>

        <Wordmark className="shrink-0" size="lg" />

        <nav className="hidden items-center gap-4 lg:ml-1 lg:flex xl:ml-6 xl:gap-7">
          {primaryLinks.map(({ href, labelKey }) => (
            <Link
              key={href}
              href={href}
              className="whitespace-nowrap text-sm font-medium text-ink-70 transition-colors hover:text-blue-deep"
            >
              {t(labelKey)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:gap-2 xl:gap-3">
          {/* On /listings the sticky FilterBar owns search, and on the
              homepage the hero panel does, so this only appears where there
              is no other way in. */}
          {!pathname.startsWith('/listings') && pathname !== '/' && (
            <Link
              href="/listings"
              aria-label={t('nav.searchAria')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
          )}
          {/* Account icon — sits directly left of the currency toggle at
              every breakpoint (was previously a `lg:`-only, logged-in-only
              affordance further right in this row; guest visitors had no
              icon at all, only the text "Connexion" link below, and mobile
              had no persistent account entry outside the hamburger Sheet).
              Guest branch links straight to the real /compte/connexion
              phone+password login — no separate signed-out affordance is
              invented, just the same real destination made reachable from
              here too. */}
          {loggedIn ? (
            AccountMenu ? (
              <AccountMenu unread={unread} triggerClassName={ACCOUNT_BUTTON_CLASS} />
            ) : (
              // Stand-in while components/HeaderAccountMenu.js loads: the
              // same button, inert for that one round trip.
              <span aria-hidden="true" data-fly-target="account" className={ACCOUNT_BUTTON_CLASS}>
                <User strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                <UnreadBadge count={unread} label={unreadText} className="absolute -right-1 -top-1 ring-2 ring-surface" />
              </span>
            )
          ) : (
            <Link
              href="/compte/connexion"
              aria-label={t('common.actions.login')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              <User strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
          )}

          {/* Desktop only. On mobile this pill sat immediately beside the
              account icon in a row that also carries the hamburger, the
              wordmark and (off the homepage) the search icon — four controls
              plus a logo inside a 4rem bar, with the currency segmented
              control the widest of them. It is a display preference, not a
              navigation destination, so it does not earn permanent space in
              a mobile navbar that is pinned to every scroll position.
              Removed from there, not deleted: the same control now appears
              as a real labelled row in the hamburger Sheet below (where a
              preference belongs, and where `longLabels` lets it read "USD"
              rather than a bare "$"), and again in the footer's own settings
              cluster (Footer.js), so it stays reachable from any scroll
              depth on any page without riding along in the header. Desktop
              keeps the inline pill — the bar genuinely has room there, and
              one-tap currency switching is a headline feature for the
              diaspora audience. */}
          <div className="hidden lg:block">
            <CurrencyToggle />
          </div>

          {/* Demandes — deliberately the currency toggle's immediate
              neighbour. Both answer "what am I already doing here": the
              currency a returning visitor reads prices in, and the requests
              they have open. Favoris used to sit between them and no longer
              appears in this row at all (see the doc comment above).

              Same real route it has always used (`/compte/demandes`, also the
              signed-in drawer's "Mes demandes" row above): it
              redirects to login with a `?next=` back to itself when signed
              out, so this link needs no logged-in branch of its own — the
              route already handles both states honestly. */}
          <Link
            href="/compte/demandes"
            className="hidden items-center gap-1.5 text-sm font-medium text-ink-70 transition-colors hover:text-blue-deep lg:inline-flex"
          >
            <Mail strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            <span className="max-xl:sr-only">{t('nav.requests')}</span>
          </Link>

          {/* Desktop only, same reasoning as the currency pill: on mobile
              this is a labelled preference row in the drawer instead, not a
              fourth control competing for a 4rem bar.

              Its slot is the last one before the CTA, which is where a
              language control belongs on a bilingual marketplace: it is the
              setting a visitor reaches for when the page did not open in
              their language, and the CTA is the one thing in this row they
              are most likely to be reading when they notice. Keeping it
              adjacent means the switch happens without crossing the whole
              bar. It is separated from the currency pill it used to sit
              beside — the two are still the same kind of control, but the
              nav link between them is what stops a row of two segmented
              pills reading as one four-option widget. */}
          <div className="hidden lg:block">
            <LanguageToggle />
          </div>

          <Link
            href={agentSignedIn ? '/compte/agent' : '/compte/agent/inscription'}
            className="u-press u-btn-secondary hidden h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[0.8125rem] font-bold text-ink lg:inline-flex xl:px-4"
          >
            {t(agentSignedIn ? 'nav.agentSpace' : 'nav.publishListing')}
            <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="hidden h-4 w-4 xl:block" />
          </Link>
        </div>
      </div>
    </header>
  );
}
