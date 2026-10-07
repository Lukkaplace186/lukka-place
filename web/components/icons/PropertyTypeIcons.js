/**
 * Property-type glyphs drawn for Lukka Place (2026-10-07), because lucide's
 * own read as generic: Building2 is one plain block, and its land icon is a
 * golf flag. Same grammar as lucide — 24×24 grid, currentColor stroke, round
 * caps and joins — so they sit beside lucide icons (House) without a seam.
 */
function Glyph({ children, strokeWidth = 1.5, className, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Apartment: a tall residential tower with balconies beside a lower block. */
export function ApartmentIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M2.5 21h19" />
      <path d="M4.5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" />
      <path d="M14.5 10h4a1 1 0 0 1 1 1v10" />
      <path d="M3.5 8h12M3.5 12.5h12M3.5 17h12" />
      <path d="M8 5.5v.01M11 5.5v.01M8 10v.01M11 10v.01M8 14.5v.01M11 14.5v.01" />
      <path d="M17 13.5v.01M17 17v.01" />
    </Glyph>
  );
}

/** Land: a plot seen in perspective, survey pegs at the back, a sapling. */
export function LandIcon(props) {
  return (
    <Glyph {...props}>
      <path d="M2 20.5 5.5 14.5h16.5l-3.5 6Z" />
      <path d="M5.5 14.5v-2M22 14.5v-2" />
      <path d="M12.5 18v-7.5" />
      <path d="M12.5 10.5c0-2.2 1.5-4 4-4 0 2.2-1.5 4-4 4Z" />
      <path d="M12.5 12.5c0-1.8-1.2-3.2-3.2-3.2 0 1.8 1.2 3.2 3.2 3.2Z" />
    </Glyph>
  );
}
