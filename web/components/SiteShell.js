/**
 * Wraps the main content column in the flex-column layout the fixed Header
 * needs to sit outside of.
 *
 * Used to also carry a `usePathname()`/`isHome` branch that toggled
 * `lg:pl-[76px]` on and off — a gutter for the fixed left icon rail
 * (SideRail.js), present everywhere except the homepage, which never had
 * the rail. Both that rail and BottomNav.js, the fixed mobile bottom bar
 * this shell used to sit above, are gone entirely now — see
 * app/(site)/layout.js's doc comment — so there is no per-route gutter or
 * bottom padding left to apply and this can stay a plain server component.
 */
export default function SiteShell({ children }) {
  return <div className="flex min-h-screen flex-col pt-16">{children}</div>;
}
