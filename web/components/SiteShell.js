/**
 * Wraps the main content column in the flex-column layout the fixed Header
 * and BottomNav need to sit outside of.
 *
 * Used to also carry a `usePathname()`/`isHome` branch that toggled
 * `lg:pl-[76px]` on and off — a gutter for the fixed left icon rail
 * (SideRail.js), present everywhere except the homepage, which never had
 * the rail. The rail is gone entirely now (removed sitewide, its
 * destinations reachable from Header's top-right utility row and
 * BottomNav), so there is no gutter left to conditionally apply and this
 * can render as a plain server component again.
 */
export default function SiteShell({ children }) {
  return <div className="flex min-h-screen flex-col pt-16">{children}</div>;
}
