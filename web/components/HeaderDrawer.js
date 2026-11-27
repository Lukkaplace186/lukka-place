'use client';

import Link from '@/components/IntentLink';
import { Heart, User, Bell, LogOut, ArrowRight, Mail, ChevronRight, SearchCheck, MessageCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from './ui/sheet';
import { ICON_STROKE_WIDTH } from '@/lib/iconStyle';
import { Wordmark } from './Brand';
import CurrencyToggle from './CurrencyToggle';
import LanguageToggle from './LanguageToggle';
import { useT } from '@/lib/i18n/client';
import UnreadBadge from './chat/UnreadBadge';
import { logoutAction } from '@/app/(site)/compte/actions';

// What the mobile drawer shows under the site links. One list per session
// state, so nothing appears twice: the drawer used to render NAV_ITEMS'
// Favoris AND ACCOUNT_LINKS' "Mes favoris" for a signed-in visitor, offer
// "Rechercher" beside Louer/Acheter (all three land on /listings), and show
// a signed-out visitor "Demandes", which only bounced them to a login page.
const DRAWER_GUEST_LINKS = [
  { href: '/favoris', labelKey: 'nav.favorites', icon: Heart },
  { href: '/compte/connexion', labelKey: 'nav.login', icon: User },
];
const DRAWER_ACCOUNT_LINKS = [
  { href: '/favoris', labelKey: 'nav.favorites', icon: Heart },
  { href: '/messages', labelKey: 'nav.messages', icon: MessageCircle },
  { href: '/compte/demandes', labelKey: 'nav.myRequests', icon: Mail },
  { href: '/compte/alertes', labelKey: 'nav.alerts', icon: Bell },
  { href: '/compte/client', labelKey: 'nav.myAccount', icon: User },
];

// Tap feedback. `hover:` never fires on a touch screen, so a tapped row gave
// no sign it had registered until the next page arrived. duration-75 keeps
// the press instant rather than easing in after the finger has lifted.
// canvas-deep is the design system's pressed fill (globals.css), used here
// instead of a generic slate.
const DRAWER_ROW = 'rounded-md transition-colors duration-75 hover:bg-canvas-alt active:bg-canvas-deep';

/**
 * The phone menu drawer, split out of Header.js on 2026-11-21 and loaded with
 * next/dynamic the first time the ☰ is pressed (or hovered/focused): the Radix
 * Dialog/Sheet stack it needs (~25 KB gzip with react-remove-scroll, focus
 * scope and tailwind-merge) was in the JavaScript of every public page while
 * most visitors never open the menu, and desktop never shows it. Same markup,
 * same rows as before; Header.js owns the open state and the trigger, so the
 * map's own ☰ (lib/siteMenu.js) still opens it.
 *
 * Radix Sheet owns focus trapping, Escape and outside-click; don't hand-roll
 * one (see web/CLAUDE.md). There is no SheetTrigger (the trigger is a plain
 * button in Header.js that renders before this chunk exists), so focus goes
 * back to `returnFocusRef` on close, the job SheetTrigger used to do.
 */
export default function HeaderDrawer({ open, onOpenChange, drawerLinks, pathname, loggedIn, agentSignedIn, unread, returnFocusRef }) {
  const t = useT();
  const unreadText = t('chat.inbox.unreadLabel', { count: unread });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[85vw] max-w-sm flex-col gap-0 bg-surface p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef?.current?.focus();
        }}
      >
        <SheetHeader className="border-b border-line px-5 py-4">
          <SheetTitle className="text-left">
            <Wordmark />
          </SheetTitle>
        </SheetHeader>
        {/* SheetContent's own close button (showCloseButton default)
            already renders top-3 right-3 over this header row — that's
            the drawer's "X", not a second one hand-rolled here (see
            web/CLAUDE.md on not hand-rolling what Radix Sheet owns). */}
        {/* Four bands, one visual style each: site links, the
            visitor's own things, display preferences, and the agent
            ask pinned to the bottom. See the DRAWER_* constants above
            for what was removed as duplication. */}
        <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-3">
          <div className="flex flex-col gap-0.5">
            {drawerLinks.map(({ href, labelKey }) => (
              <SheetClose asChild key={href}>
                <Link href={href} className={`${DRAWER_ROW} flex items-center justify-between px-3 py-3 text-base font-semibold text-ink`}>
                  {t(labelKey)}
                  <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-45" />
                </Link>
              </SheetClose>
            ))}
          </div>

          <span className="my-2 h-px bg-line" />

          <div className="flex flex-col gap-0.5">
            {(loggedIn ? DRAWER_ACCOUNT_LINKS : DRAWER_GUEST_LINKS).map(({ href, labelKey, icon: Icon }) => (
              <SheetClose asChild key={href}>
                <Link
                  href={href}
                  className={`${DRAWER_ROW} flex min-h-11 items-center gap-3 px-3 py-2.5 text-[0.9375rem] font-medium ${
                    pathname === href ? 'text-blue-deep' : 'text-ink'
                  }`}
                >
                  <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                  {t(labelKey)}
                  {href === '/messages' ? <UnreadBadge count={unread} label={unreadText} className="ml-auto" /> : null}
                </Link>
              </SheetClose>
            ))}
            {loggedIn && (
              <SheetClose asChild>
                <button
                  type="button"
                  onClick={() => logoutAction()}
                  className={`${DRAWER_ROW} flex min-h-11 items-center gap-3 px-3 py-2.5 text-left text-[0.9375rem] font-medium text-ink-70`}
                >
                  <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                  {t('common.actions.logout')}
                </button>
              </SheetClose>
            )}
          </div>

          <span className="my-2 h-px bg-line" />

          {/* Display preferences, one row. Both toggles carry their own
              aria-label, so the visible "Devise d'affichage" / "Langue"
              captions were two rows of words explaining two controls
              that already read as USD|FC and FR|EN. Not wrapped in
              SheetClose: a preference change should be watched taking
              effect, not dismiss the drawer. */}
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <CurrencyToggle longLabels tone="quiet" />
            <LanguageToggle tone="quiet" />
          </div>

          {/* "Trouver pour moi" — the customer's way in when browsing
              has not found it: the real request form, whose request is
              pushed to partner agencies (Automated Agent Matching).
              /compte/client/* sends a guest to sign in first, so no
              logged-in branch is needed. */}
          <SheetClose asChild>
            <Link
              href="/compte/client/demandes"
              className="group mx-1 mt-3 flex min-h-11 flex-col gap-1.5 rounded-xl border border-blue/15 bg-blue-tint p-4 transition-colors duration-75 active:bg-canvas-deep [@media(max-height:780px)]:gap-1 [@media(max-height:780px)]:p-3"
            >
              <span className="flex items-center gap-2 text-[0.9375rem] font-bold text-ink">
                <SearchCheck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-blue-deep" />
                {t('nav.findPrompt')}
              </span>
              {/* Dropped on short phones (iPhone SE class): the title and the CTA
                  still say what this is, and it keeps "Publier un bien"
                  above the fold instead of behind a scroll. */}
              <span className="text-[0.8125rem] leading-snug text-ink-70 [@media(max-height:780px)]:hidden">{t('nav.findLead')}</span>
              <span className="inline-flex items-center gap-1.5 pt-1 text-[0.875rem] font-bold text-blue-deep">
                {t('nav.findCta')}
                <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 transition-transform group-active:translate-x-0.5" />
              </span>
            </Link>
          </SheetClose>

          {/* The agent ask, pinned to the bottom. One block, one
              hierarchy: publishing is the filled action and the
              existing-agent login a quiet link under it. */}
          {/* Spacer: pins the agent block to the bottom on a tall phone,
              and still keeps 1.5rem above it on a short one, where
              mt-auto alone would collapse to zero. */}
          <div aria-hidden="true" className="min-h-5 flex-1" />
          <div className="border-t border-line px-1 pt-4 pb-1">
            <p className="px-2 pb-2 text-[0.8125rem] font-medium text-ink-70">
              {t(agentSignedIn ? 'nav.agentSignedIn' : 'nav.agentPrompt')}
            </p>
            <SheetClose asChild>
              <Link
                href={agentSignedIn ? '/compte/agent' : '/compte/agent/inscription'}
                className="u-press u-btn-primary flex w-full items-center justify-center gap-2 rounded-lg bg-blue py-3 text-[0.9375rem] font-bold text-white"
              >
                {t(agentSignedIn ? 'nav.agentSpace' : 'nav.publishListing')}
                <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </Link>
            </SheetClose>
            <SheetClose asChild>
              <Link
                href={agentSignedIn ? '/compte/agent/demandes' : '/compte/agent/connexion'}
                className={`${DRAWER_ROW} mt-1 flex min-h-11 items-center justify-center px-2 py-2.5 text-center text-[0.8125rem] font-semibold text-blue-deep`}
              >
                {t(agentSignedIn ? 'nav.agentEnquiries' : 'nav.agentLogin')}
              </Link>
            </SheetClose>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
