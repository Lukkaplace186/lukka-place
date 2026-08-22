'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, User, Heart, Bell, LogOut } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from './ui/sheet';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from './ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { NAV_ITEMS, isNavItemActive } from './navItems';
import { Wordmark } from './Brand';
import CurrencyToggle from './CurrencyToggle';
import { useIsLoggedIn } from '@/lib/customerClient';
import { logoutAction } from '@/app/(site)/compte/actions';

const ACCOUNT_LINKS = [
  { href: '/compte', label: 'Mon compte', icon: User },
  { href: '/favoris', label: 'Mes favoris', icon: Heart },
  { href: '/compte/alertes', label: 'Alertes', icon: Bell },
];

const PRIMARY_LINKS = [
  { href: '/listings?transaction_type=location', label: 'Louer' },
  { href: '/listings?transaction_type=vente', label: 'Acheter' },
  { href: '/a-propos', label: 'À propos' },
];

/**
 * Sticky site header.
 *
 * On the homepage it starts transparent so the hero photograph runs to the
 * top of the viewport, then solidifies once scrolled. Everywhere else it is
 * solid from the start.
 *
 * Implementation note: this uses a rAF-throttled passive scroll listener
 * rather than an IntersectionObserver. The IO "is it stuck?" trick needs a
 * sentinel node or a `top: -1px` offset hack to distinguish "resting at the
 * top of the page" from "pinned to the top of the viewport", and both of
 * those are more moving parts than the two-line listener below for the same
 * result. Passive + rAF means it never blocks scrolling.
 *
 * Height is 4rem/h-16 and is depended on elsewhere: FilterBar sticks at
 * `top-16` so the two never overlap, and SideRail's top padding clears it.
 */
export default function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const loggedIn = useIsLoggedIn();

  const overHero = pathname === '/' && !scrolled;

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24);
        frame = 0;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-[60] h-16 transition-colors duration-300 ${
        overHero ? 'bg-transparent' : 'border-b border-line bg-canvas/90 backdrop-blur-md'
      }`}
    >
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 lg:w-[76px] lg:shrink-0 lg:pl-0">
          {/* Mobile menu — Radix Sheet owns focus trapping, Escape and
              outside-click; don't hand-roll one (see web/CLAUDE.md). */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              aria-label="Ouvrir le menu"
              className={`-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors lg:hidden ${
                overHero ? 'text-white hover:bg-white/15' : 'text-ink hover:bg-canvas-deep'
              }`}
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
              </nav>
            </SheetContent>
          </Sheet>
        </div>

        <Wordmark inverted={overHero} className="shrink-0" />

        <nav className="ml-6 hidden items-center gap-7 lg:flex">
          {PRIMARY_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm font-medium transition-colors ${
                overHero ? 'text-white/85 hover:text-white' : 'text-ink-70 hover:text-blue-deep'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* On /listings the sticky FilterBar already owns search, so this
              only appears where there is no other way in. */}
          {!pathname.startsWith('/listings') && pathname !== '/' && (
            <Link
              href="/listings"
              aria-label="Rechercher un bien"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line text-ink-70 transition-colors hover:border-blue hover:text-blue-deep"
            >
              <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
          )}
          <CurrencyToggle inverted={overHero} />

          {loggedIn ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Mon compte"
                className={`hidden h-11 w-11 items-center justify-center rounded-full border transition-colors lg:inline-flex ${
                  overHero
                    ? 'border-white/30 text-white hover:bg-white/15'
                    : 'border-line text-ink-70 hover:border-blue hover:text-blue-deep'
                }`}
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
              className={`hidden text-sm font-medium transition-colors lg:inline-block ${
                overHero ? 'text-white/85 hover:text-white' : 'text-ink-70 hover:text-blue-deep'
              }`}
            >
              Connexion
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
