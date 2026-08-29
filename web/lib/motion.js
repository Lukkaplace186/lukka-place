// Shared framer-motion presets so hovers/transitions feel consistent across
// the site instead of every component inventing its own duration/easing.
//
// Scope note: shadcn's Radix-based Dialog/Sheet (components/ui/dialog.jsx,
// sheet.jsx) already animate open/close via CSS `data-[state=open/closed]`
// classes (tw-animate-css, wired in app/globals.css) — that's real, already
// "smooth" enter/exit, not an abrupt toggle. Don't also wrap DialogContent /
// SheetContent in a `motion.div`: Radix unmounts the node as soon as
// `open` flips, so a framer-motion exit animation on the same node never
// gets to run (it needs `AnimatePresence` + Radix's `forceMount` prop wired
// together, which these components don't do — not worth the complexity here).
// Reach for framer-motion for what CSS state-classes can't do: card hover/tap
// micro-interactions, and a `layoutId`-based sliding indicator for tabs.

export const EASE = [0.16, 1, 0.3, 1]; // ease-out-expo — snappy settle, no bounce

export const cardHover = {
  rest: { y: 0, scale: 1 },
  hover: { y: -4, scale: 1.01, transition: { duration: 0.2, ease: EASE } },
};

// Spread onto a `motion.div` wrapping ListingCard / FeaturedListingCard:
// <motion.div initial="rest" whileHover="hover" animate="rest" variants={cardHover}>
export const cardHoverProps = {
  initial: 'rest',
  whileHover: 'hover',
  animate: 'rest',
  variants: cardHover,
};

export const fadeInUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE } },
};

// Spring config for a `layoutId`-shared active-tab pill/underline — pair with
// a single motion.div per active tab, e.g.:
// {active && <motion.div layoutId="tab-indicator" transition={tabIndicatorTransition} className="..." />}
export const tabIndicatorTransition = { type: 'spring', stiffness: 500, damping: 40 };

// ---------------------------------------------------------------------------
// Overhaul additions
// ---------------------------------------------------------------------------

// Section reveal. Deliberately longer and further-travelling than fadeInUp
// (24px/0.6s vs 8px/0.25s) — fadeInUp is a list-item tweak, this is for a
// whole section arriving as the page is scrolled. Pair with `revealStagger`
// on the parent so children arrive in sequence rather than all at once.
export const revealUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

export const revealStagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
};

// Slow zoom on a card's photo while the card is hovered. This is the single
// highest-value micro-interaction on a property site: it makes the image feel
// like the subject rather than a thumbnail. Apply to the <img> wrapper inside
// an `overflow-hidden` parent, driven by the card's own hover variant name.
export const imageZoom = {
  rest: { scale: 1, transition: { duration: 0.7, ease: EASE } },
  hover: { scale: 1.06, transition: { duration: 0.7, ease: EASE } },
};

// Lightbox / overlay enter+exit. Used with AnimatePresence on our own
// elements — NOT on Radix DialogContent (see the scope note at the top).
export const fadeScale = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15, ease: EASE } },
};

// Very slow drift for the hero photograph. Subtle enough to read as depth
// rather than as an animation; anything faster reads as a slideshow.
export const heroDrift = {
  initial: { scale: 1.06 },
  animate: { scale: 1, transition: { duration: 18, ease: 'linear' } },
};

// A quick "pop" for a toggled glyph — the saved-heart in FavoriteButton.js,
// the alert bell in SaveSearchButton.js — triggered by remounting a
// motion.span on a click-driven key (see either component) so it fires once
// per actual toggle, never on hydration/mount. A keyframe array forces
// framer-motion into tween interpolation regardless of `type`, so this
// reaches for a back-out cubic-bezier (overshoots past 1.15 then settles)
// instead of `type: 'spring'` — the standard way to fake spring bounce with
// keyframes rather than fighting the two systems together.
export const iconPop = { scale: [0.6, 1.15, 1], transition: { duration: 0.4, ease: [0.34, 1.56, 0.64, 1] } };
