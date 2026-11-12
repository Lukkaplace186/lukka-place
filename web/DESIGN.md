---
name: Lukka Place
description: "Kinshasa's property portal: verified listings, real agents, prices you can compare."
colors:
  ink: "#0b1120"
  ink-70: "#2c3444"
  ink-45: "#5c6679"
  ink-35: "#7c879c"
  ink-25: "#cbd2e0"
  page: "#f8f9fa"
  canvas: "#ffffff"
  surface: "#ffffff"
  canvas-alt: "#f7f7f5"
  canvas-deep: "#eff1f6"
  canvas-warm: "#f9f8f6"
  line: "#e2e6ef"
  blue: "#1e3aa8"
  blue-deep: "#16307e"
  blue-900: "#0c1d50"
  blue-400: "#4761d8"
  blue-tint: "#eef2ff"
  brand-royal: "#144fc5"
  brass: "#a97c2f"
  brass-deep: "#7a5619"
  brass-tint: "#f3e7ce"
  green: "#00b050"
  green-deep: "#00963f"
  green-ink: "#007c34"
  green-tint: "#e6f8ee"
  success: "#1e7b54"
  success-tint: "#e7f4ee"
  warning: "#b5751a"
  warning-ink: "#7a5619"
  warning-tint: "#fbf1df"
  danger: "#b3261e"
  danger-tint: "#fbeae8"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  headline-storefront:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title-card:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  title-sub:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.1px"
  price:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: "2rem"
    letterSpacing: "0.1px"
    fontFeature: "\"tnum\" 1"
  stat:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    letterSpacing: "0.1px"
  meta:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    letterSpacing: "0.1px"
  micro:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    letterSpacing: "0.1px"
  label:
    fontFamily: "Plus Jakarta Sans, -apple-system, Segoe UI, Roboto, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
    letterSpacing: "1px"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  card: "14px"
  panel: "16px"
  full: "999px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.canvas}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "12px 24px"
  button-primary-hover:
    backgroundColor: "{colors.blue-deep}"
    textColor: "{colors.canvas}"
  button-primary-press:
    backgroundColor: "{colors.blue-900}"
    textColor: "{colors.canvas}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "12px 24px"
  button-secondary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
  button-whatsapp:
    backgroundColor: "{colors.green}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.xl}"
    height: "44px"
    padding: "0 16px"
  button-whatsapp-hover:
    backgroundColor: "{colors.green-deep}"
    textColor: "{colors.canvas}"
  filter-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-70}"
    typography: "{typography.micro}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
  filter-pill-active:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.blue-deep}"
  option-pill-selected:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.canvas}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
  tag:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-70}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: "64px"
---

# Design System: Lukka Place

Tokens live in `app/globals.css` (Tailwind v4, no config file: every `--color-*` and `--radius-*` in its `@theme` block is a utility). This file describes them; when the two disagree, the CSS is what ships and this file is stale. Engineering history and the reasoning behind each value are in `web/CLAUDE.md`.

## Overview

**Creative North Star: "Prestige White, Royal Action"**

A white page, ink type, and one royal blue that speaks only when there is something to do. The look borrows the skeleton of the big property portals (filter pills, card anatomy, a map and results split) and makes it feel calm and credible rather than loud. Photographs of real Kinshasa properties carry the colour; the interface stays out of their way.

Density is split by surface on purpose: `/listings` and every dashboard (agent space, Espace Client, `/admin`) are dense and scannable; the home page and a listing's own page are airier. Scan fast to find, linger to decide. The same type scale, buttons and cards run across all four surfaces so the storefront, the agent portal, the Espace Client and the admin console read as one product.

Most visitors use budget Android phones on slow links. That is a design constraint, not an afterthought: motion is CSS only, blur is switched off on touch screens, and every tap target reaches 44px.

**Key Characteristics:**
- White tiles on a cool off-white page; separation by hairline and a faint shadow, never by heavy boxes.
- One family, Plus Jakarta Sans, everywhere; hierarchy by size and weight only.
- Royal blue is the only action colour. Brass is a rare prestige mark, green is WhatsApp.
- Prices are modest (24px, weight 500) and always tabular.
- Sentence-case French titles; uppercase only for micro labels and badges.

## Colors

A cool, near-monochrome ink-and-white system with a single royal accent and two signal colours that each have exactly one job.

### Primary
- **Royal Action Blue** (`blue`): every primary button, link, active filter, selected option and focus border. White on it passes AAA (7.9:1), and it is safe as text on white too. Hover goes to **Deep Royal** (`blue-deep`), press to **Midnight Royal** (`blue-900`).
- **Royal Wash** (`blue-tint`): the fill behind an active filter pill or a highlighted row, with Deep Royal text on it.
- **Focus Periwinkle** (`blue-400`): focus rings only, nothing else.
- **Logo Royal** (`brand-royal`): the logo, share images (OG cards), confetti and video ads. Not a UI colour: buttons and links use Royal Action Blue.

### Secondary
- **Brass** (`brass`) and **Deep Brass** (`brass-deep`): a sparing prestige accent for premium flags, award marks and fine rules. Brass is a badge fill with large bold caps on it (3.2:1, large-text only); Deep Brass is the text version (7.3:1). Used a handful of times across the whole app.

### Tertiary
- **WhatsApp Green** (`green`, hover `green-deep`): the WhatsApp call-to-action and the rental-income signal. A fill only: white body text on it fails contrast.
- **Leaf Ink** (`green-ink`): every piece of green text, such as the "Publiée le…" freshness stamp (5.34:1).

### Neutral
- **Night Ink** (`ink`): headings and primary text.
- **Body Slate** (`ink-70`): paragraph copy and resting control labels.
- **Muted Slate** (`ink-45`): meta lines, captions, micro labels.
- **Faint Slate** (`ink-35`): the faintest readable meta.
- **Mist** (`ink-25`): placeholders, disabled states and tag outlines; decorative only, never text a visitor must read.
- **Cool Page** (`page`): the ground under everything, so white tiles read as raised without a border.
- **White** (`canvas`, `surface`): cards, header, inputs, sheets, button fills.
- **Chalk** (`canvas-alt`) and **Mist Well** (`canvas-deep`): sunken sections, hover and pressed fills, image wells.
- **Hairline** (`line`): borders and the 1px inset that separates cards.
- **Warm Stone** (`canvas-warm`): the Espace Client portal's ground only (`/compte/client/*`).

### Status
- **Success / Warning / Danger** each come as a tint fill with an ink on it (`success` on `success-tint`, `warning-ink` on `warning-tint`, `danger` on `danger-tint`) for status pills, lead stages and listing-state chips. Small text on the warning tint uses `warning-ink`; `warning` itself is for icons, fills and large text.

### Named Rules
**The One Voice Rule.** Royal blue is the only colour that means "act here". If two things on a screen are blue, only one of them should be the main action.

**The Fill-or-Text Rule.** Every accent is measured, not guessed: `blue` works as fill and text; `brass` and `green` are fills, and their text versions are `brass-deep` and `green-ink`.

**The Photographs Carry the Colour Rule.** The interface stays ink and white so property photos are the most colourful thing on the page.

## Typography

**Display Font:** Plus Jakarta Sans (with -apple-system, Segoe UI, Roboto, system-ui)
**Body Font:** Plus Jakarta Sans (same stack)

**Character:** One geometric-humanist sans for everything, from a page title to a table cell. A serif (DM Serif Display) carried titles until 2026-10-24 and was removed by the owner because it clashed with the labels beside it.

### Hierarchy
- **Display** (700, 28px phone → 36px from 640px, 1.15): the h1 of an editorial full page, such as the Espace Client and saved-search pages. Class `.u-title-hero`.
- **Headline** (700, 22px → 28px, 1.2): every dashboard page header, agent and admin alike, one per screen. Class `.u-title-page`. The storefront's section titles use the slightly smaller **Headline Storefront** (700, 22px → 26px) via `.u-title-storefront`.
- **Title** (700, 20px, 1.3): a band within a page, the heading over a table, auth-card titles. Class `.u-title-section`.
- **Card Title** (700, 17px, 1.4): the heading inside one card or panel. Class `.u-title-card`. **Sub-title** (700, 15px) labels a field cluster: `.u-title-sub`.
- **Price** (500, 24px, tabular): every price on a card or listing page; nothing on a card is larger. Class `.u-price` with `.u-tabular`.
- **Stat** (800, 22px → 28px, tabular): one headline number on a stat tile. Class `.u-stat`.
- **Body** (400, 16px, 24px leading): descriptions and paragraphs. Class `.u-body`. **Meta** (400, 14px) for secondary lines: `.u-meta`.
- **Micro** (400 or 600, 13px): the dashboard workhorse for table cells, filter controls, form labels. Classes `.u-micro` / `.u-micro-strong`.
- **Label** (500, 12px, 1px tracking, uppercase, Muted Slate): spec keys, section kickers, commune labels. Class `.u-eyebrow` (`.u-eyebrow-ink` for the full-ink version).
- **Reference** (11px, 0.08em, uppercase, tabular): listing reference codes. Class `.u-ref`.

Body text carries a global +0.1px letter-spacing; titles tighten slightly (−0.005em to −0.02em).

### Named Rules
**The No New Sizes Rule.** Use the scale's classes; never write a new arbitrary `text-[…]`. One-off sizes are how the app once ended up with four typographic dialects.

**The Quiet Price Rule.** A price is 24px at weight 500, tabular, never bigger or blacker. A column of prices must line up.

**The Sentence Case Rule.** Titles are written in sentence case as the dictionary writes them; capitals are reserved for micro labels, badges and reference codes.

## Layout

Content sits in a centred container up to 1600px wide on the storefront and dashboards (a few narrower reading pages use 1240px or `max-w-5xl`). Spacing follows Tailwind's 4px scale; there are no custom spacing tokens. Breakpoints are Tailwind's defaults (640, 768, 1024, 1280px), and the type scale steps up at 640px.

A fixed white header (64px) runs across the top of every page with a bottom hairline and a shadow that deepens as the page scrolls. There is no persistent bottom bar on mobile and no left icon rail on desktop: secondary destinations live in the header's account menu and mobile sheet, and floating per-page actions sit at the true bottom of the viewport.

`/listings` is a split view: a paginated card list beside a viewport map on desktop, the map as a full-screen layer on mobile. Everything is designed at 375px first; a title that pushes a dashboard wider than a 375px screen is a bug.

**The 44px Rule.** Every tap target is at least 44×44px. A control drawn smaller (a 40px heart over a photo) gets an invisible hit area with `.u-hit`.

## Elevation & Depth

A hybrid: surfaces are separated by hairlines and a faint micro-shadow, and only things that truly float get real elevation. Shadows are tinted with the ink colour, not pure black, except the card shadows, which follow a common portal standard at 6–8% black.

### Shadow Vocabulary
- **Card rest** (`box-shadow: inset 0 0 0 1px #e2e6ef, 0 2px 8px rgba(0,0,0,0.06)`): every card and photo frame (`.u-card`, `.u-media-frame`).
- **Card hover** (`box-shadow: inset 0 0 0 1px #e2e6ef, 0 4px 16px rgba(0,0,0,0.08)`, plus a 2px lift): interactive cards on devices with a real pointer (`.u-card-interactive`).
- **Lift** (`box-shadow: 0 1px 2px rgb(11 17 32 / 0.06), 0 8px 24px -6px rgb(11 17 32 / 0.1)`): popovers, dropdowns, menus (`.u-lift`).
- **Lift large** (`box-shadow: 0 2px 4px rgb(11 17 32 / 0.06), 0 24px 48px -12px rgb(11 17 32 / 0.18)`): the listing preview panel that floats over the map (`.u-lift-lg`).
- **Royal panel** (`box-shadow: 0 24px 60px -24px rgba(12, 29, 80, 0.35)`): only the hero search panel floating over the home photograph (`.u-shadow-panel`).
- **Royal glow** (`box-shadow: 0 10px 24px -10px rgba(30, 58, 168, 0.45)`): a primary button on hover.
- **Focus** (`box-shadow: 0 0 0 3px rgba(71, 97, 216, 0.32)`): form fields on focus, with a royal border.

### Over photographs
Short metadata over a photo (photo count "1/23") sits in a frosted royal capsule (`.u-glass-royal`); round controls over a photo (gallery arrows, close) sit in a frosted white capsule (`.u-glass-white`). On touch screens the blur is replaced by a more opaque fill, because blur on every card stutters on budget phone GPUs. Card photos get only a faint fade on the bottom edge (ink at 0 → 26%) so white carousel dots stay visible.

### Named Rules
**The Hairline First Rule.** A card is separated by its 1px inset hairline and a faint resting shadow, never by a visible outlined border or a big drop shadow.

**The Bright Photos Rule.** Never darken a property photo to make text readable. Long text over an image uses the short bottom fade; short metadata uses a capsule; never both on the same edge.

## Shapes

Gently rounded and consistent. Controls, inputs and filter pills use an 8px radius; listing cards and the hero search panel 14px; full-width royal panels 16px. Fully round pills are for primary CTAs, badges, tags, counters and avatars. Image wells inside cards follow the card's corner. Nothing is sharp-cornered, and nothing is a soft blob.

## Components

### Buttons
Confident and tactile: they lift on hover and give a little on press.
- **Shape:** fully round (999px) for primary page actions; 8px for compact controls built on the shared `Button` component.
- **Primary:** Royal Action Blue with white semibold 14px text, about 12px × 24px padding. Hover (on pointer devices only) turns Deep Royal, rises 2px and gains the royal glow; press turns Midnight Royal and scales to 98.5%. Classes `bg-blue … u-btn-primary`.
- **Secondary:** transparent with a bold 1.5px Night Ink inset border and ink text; hover and press invert to a solid ink fill with white text (`.u-btn-secondary`). Not a faint hairline button, which reads as disabled.
- **WhatsApp:** WhatsApp Green, white semibold text, 12px radius, 44px tall, with the WhatsApp glyph; hover WhatsApp Green deep.
- **Press feedback:** tappable pills and icon buttons scale to 96% on press (`.u-press`), even with reduced motion on, since it answers the visitor's own tap.

### Chips
- **Filter pill:** white, Body Slate 13px medium text, 8px radius, hairline border, a small chevron. Active: Royal Wash fill, royal border, Deep Royal text, showing the chosen value instead of the label.
- **Option pill** (inside a filter popover): white with hairline at rest; selected is solid Royal Action Blue with white text.
- **Tag:** sentence-case descriptive chip, white with a Mist inset outline, Body Slate 13px text, fully round (`.u-tag`).
- **Badge:** uppercase 11px bold stamp at 0.12em tracking, fully round, used over imagery for status. Badge and Tag are deliberately different and not interchangeable.

### Cards / Containers
- **Corner Style:** 14px (`rounded-card`).
- **Background:** white on the cool page ground.
- **Shadow Strategy:** card rest; card hover with a 2px lift on interactive cards (see Elevation).
- **Border:** none visible; the inset hairline does the work.
- **Listing cards:** three layouts on purpose, one visual language: a horizontal card with a one-large, two-small photo collage (`/favoris`), a vertical grid card (`/listings`), and a homepage carousel teaser.

### Inputs / Fields
- **Style:** white fill, 1px hairline border, 8px radius, 40px tall, 14px ink text (13px in dense filter rows).
- **Focus:** royal border plus the soft royal focus ring (`.u-focus-ring`). The outline is never removed without that ring replacing it.
- **Touch:** text fields render at 16px or more on touch screens so iOS never zooms in.

### Navigation
- **Header:** fixed, white, 64px, bottom hairline; links in ink at 13–15px; account menu on the right; a hamburger sheet on mobile. Its shadow appears as the page scrolls.
- **No bottom tab bar and no side rail.** Floating per-page action bars sit at the viewport bottom on mobile instead.
- **Icons:** `lucide-react` only, 18px at 1.75 stroke. The WhatsApp, Facebook and Instagram marks are the one exception, hand-drawn SVGs.

### Map pins (signature)
The listings map deliberately leaves the site palette: a vivid basemap (green parks, blue water, warm roads) so Kinshasa reads as a real place. Every listing is a white speech-bubble pill showing its price (`$1.5k`); the active one turns royal blue. No clusters, no dots.

### Motion
CSS only (no animation library), and every decorative entrance is off under reduced motion. Entrances rise 24px and fade in with a soft ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`), 0.22s for a small panel and up to 0.6s for a card; homepage rails reveal as they scroll into view, with no JavaScript. State changes take 0.12–0.2s. Keyframes animate `translate` and `scale`, never `transform`, so an entrance can't cancel a hover or press on the same element. Moments of delight are small and earned: a heart burst on save, a single shine across a confirmed visit, confetti on an agent's first milestone.

## Do's and Don'ts

### Do:
- **Do** use Royal Action Blue (`bg-blue` + `.u-btn-primary`) for the one main action on a screen, and Deep Royal for links and text on tints.
- **Do** set every price with `.u-price` and `.u-tabular`; prices are 24px, weight 500.
- **Do** take every title and label size from the scale (`.u-title-*`, `.u-micro`, `.u-eyebrow`…).
- **Do** separate cards with the hairline-plus-faint-shadow `.u-card`, on the cool page ground.
- **Do** gate hover styles on `(hover: hover)`; Android keeps `:hover` on the last thing tapped.
- **Do** design at 375px first and keep every tap target at 44px.
- **Do** show real photos of the actual property; when a fact or photo is missing, say so plainly in the interface.

### Don't:
- **Don't** add a second font family or bring back a serif for titles (removed 2026-10-24).
- **Don't** use brass as a button, or brass and green as body-size text; use `brass-deep` and `green-ink` for text.
- **Don't** use Logo Royal (`brand-royal`) for buttons or links, or Focus Periwinkle for anything but focus rings.
- **Don't** add a second ground colour or warm band to the storefront; separate homepage sections with hairlines and spacing. Warm Stone belongs to the Espace Client only.
- **Don't** darken property photos with heavy gradients, or stack a scrim and a glass capsule on the same edge.
- **Don't** make prices or headings huge and black: nothing on a listing card is larger than the 24px price.
- **Don't** set titles in capitals.
- **Don't** use backdrop blur that stays on for touch screens, or ship an animation library.
- **Don't** use stock or stand-in photographs where a listing's own photo belongs.
- **Don't** "fix" the map back to the site palette.
