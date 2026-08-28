'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, User, Heart, Bell, LogOut, ArrowUpRight, Mail } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from './ui/sheet';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { NAV_ITEMS, isNavItemActive } from './navItems';
import { Wordmark } from './Brand';
import CurrencyToggle from './CurrencyToggle';
import { useIsLoggedIn } from '@/lib/customerClient';
import { logoutAction } from '@/app/(site)/compte/actions';

const ACCOUNT_LINKS = [
  { href: '/compte/client', label: 'Mon compte', icon: User },
  { href: '/favoris', label: 'Mes favoris', icon: Heart },
  { href: '/compte/alertes', label: 'Alertes', icon: Bell },
];

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
 * destinations are distinguished only by a query string
 * (?transaction_type=...), and reading that from a layout-level client
 * component means useSearchParams(), which drags every statically rendered
 * route under this layout into a Suspense bailout (see web/CLAUDE.md).
 * Hover colour only, rather than an underline that would be right on two
 * links and silently wrong on the other two.
 */
const PRIMARY_LINKS = [
  { href: '/listings?transaction_type=location', label: 'Louer' },
  { href: '/listings?transaction_type=vente', label: 'Acheter' },
  { href: '/agents', label: 'Agences' },
  { href: '/a-propos', label: 'À propos' },
];

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
 * Also carries Demandes now — a top-right text link next to Favoris,
 * routing to the same `/compte/demandes` the mobile tab bar always used.
 * It used to live only on the fixed left icon rail (SideRail.js), which
 * had no desktop equivalent anywhere else; that rail is gone entirely (see
 * app/(site)/layout.js), so every page under this layout gets its full
 * container width back instead of losing 76px to a gutter.
 */
export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const loggedIn = useIsLoggedIn();

  return (
    <header className="fixed inset-x-0 top-0 z-[60] h-16 border-b border-line bg-surface shadow-sm">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:w-[76px] lg:shrink-0 lg:pl-0">
          {/* Mobile menu — Radix Sheet owns focus trapping, Escape and
              outside-click; don't hand-roll one (see web/CLAUDE.md). */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              aria-label="Ouvrir le menu"
              className="-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-ink transition-colors hover:bg-canvas-deep lg:hidden"
            >
              <Menu strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[17rem] bg-surface p-0">
              <SheetHeader className="border-b border-line px-5 py-4">
                <SheetTitle className="text-left">
                  <Wordmark />
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col px-2 py-3">
                {PRIMARY_LINKS.map(({ href, label }) => (
                  <SheetClose asChild key={href}>
                    <Link href={href} className="rounded-md px-3 py-2.5 text-[0.9375rem] font-medium text-ink hover:bg-canvas-alt">
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <span className="my-2 h-px bg-line" />
                {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                  <SheetClose asChild key={href}>
                    <Link
                      href={href}
                      className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.9375rem] font-medium hover:bg-canvas-alt ${
                        isNavItemActive(href, pathname) ? 'text-blue-deep' : 'text-ink'
                      }`}
                    >
                      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                      {label}
                    </Link>
                  </SheetClose>
                ))}
                <span className="my-2 h-px bg-line" />
                {loggedIn ? (
                  <>
                    {ACCOUNT_LINKS.map(({ href, label, icon: Icon }) => (
                      <SheetClose asChild key={href}>
                        <Link href={href} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.9375rem] font-medium text-ink hover:bg-canvas-alt">
                          <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                          {label}
                        </Link>
                      </SheetClose>
                    ))}
                    <SheetClose asChild>
                      <button
                        type="button"
                        onClick={() => logoutAction()}
                        className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-[0.9375rem] font-medium text-ink hover:bg-canvas-alt"
                      >
                        <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                        Se déconnecter
                      </button>
                    </SheetClose>
                  </>
                ) : (
                  <SheetClose asChild>
                    <Link href="/compte/connexion" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.9375rem] font-medium text-ink hover:bg-canvas-alt">
                      <User strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                      Connexion
                    </Link>
                  </SheetClose>
                )}

                <SheetClose asChild>
                  <Link
                    href="/compte/agent/inscription"
                    className="mt-2 flex items-center justify-center gap-2 rounded-md bg-blue-tint px-3 py-2.5 text-[0.9375rem] font-bold text-blue-deep"
                  >
                    Publier un bien
                  </Link>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>

        <Wordmark className="shrink-0" />

        <nav className="ml-6 hidden items-center gap-7 lg:flex">
          {PRIMARY_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="text-sm font-medium text-ink-70 transition-colors hover:text-blue-deep"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* On /listings the sticky FilterBar owns search, and on the
              homepage the hero panel does, so this only appears where there
              is no other way in. */}
          {!pathname.startsWith('/listings') && pathname !== '/' && (
            <Link
              href="/listings"
              aria-label="Rechercher un bien"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
          )}
          <CurrencyToggle />

          {/* Favoris — web/Design's header always shows this text link,
              never gated behind login: favorites are local-only
              (lib/localFavorites.js), no account required. */}
          <Link
            href="/favoris"
            className="hidden items-center gap-1.5 text-sm font-medium text-ink-70 transition-colors hover:text-blue-deep lg:inline-flex"
          >
            <Heart strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Favoris
          </Link>

          {/* Demandes — moved here from the now-removed left icon rail
              (SideRail.js). Same real route as before (`/compte/demandes`,
              still the one NAV_ITEMS uses in the mobile Sheet menu below):
              it redirects to login with a `?next=` back to itself when
              signed out, so this link doesn't need its own logged-in
              branch — the route already handles both states honestly. */}
          <Link
            href="/compte/demandes"
            className="hidden items-center gap-1.5 text-sm font-medium text-ink-70 transition-colors hover:text-blue-deep lg:inline-flex"
          >
            <Mail strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            Demandes
          </Link>

          {loggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Mon compte"
                className="hidden h-11 w-11 items-center justify-center rounded-full border border-line text-ink-70 transition-colors hover:border-blue hover:text-blue-deep lg:inline-flex"
              >
                <User strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ACCOUNT_LINKS.map(({ href, label, icon: Icon }) => (
                  <DropdownMenuItem key={href} asChild>
                    <Link href={href} className="flex items-center gap-2.5">
                      <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
                      {label}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logoutAction()} className="flex items-center gap-2.5">
                  <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
                  Se déconnecter
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href="/compte/connexion"
              className="hidden text-sm font-medium text-ink-70 transition-colors hover:text-blue-deep lg:inline-block"
            >
              Connexion
            </Link>
          )}

          <Link
            href="/compte/agent/inscription"
            className="u-press u-btn-secondary hidden h-9 items-center gap-1.5 rounded-lg px-4 text-[0.8125rem] font-bold text-ink lg:inline-flex"
          >
            Publier un bien
            <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
