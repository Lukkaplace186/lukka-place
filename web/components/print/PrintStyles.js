/**
 * Styles for the A4 print pages (window poster, technical sheet), scoped to
 * `.lp-print` and shipped with the page rather than in app/globals.css, so the
 * rest of the dashboard is untouched.
 *
 * ONE LAYOUT AT EVERY SIZE. Each `.lp-sheet` is a size container whose width
 * is min(210mm, 100%) and whose height follows A4's ratio; every length inside
 * is in `cqw` (1% of the sheet's width). On a 375px phone the sheet is a
 * faithful miniature with no horizontal scroll; printed, 1cqw is 2.1mm and the
 * page is exactly A4. No transform/scale trick, which would leave the layout
 * box at full width and scroll the phone sideways.
 *
 * PRINTING hides the dashboard chrome (sidebar, bottom nav, toolbar) and
 * gives each sheet one page. `print-color-adjust: exact` keeps the blue band —
 * browsers drop backgrounds by default when printing.
 */
const CSS = `
.lp-print { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 16px 12px 32px; }
.lp-sheet {
  container-type: inline-size;
  position: relative; box-sizing: border-box; overflow: hidden;
  width: min(210mm, 100%); aspect-ratio: 210 / 297;
  background: #fff; color: var(--ink);
  font-family: var(--font-jakarta), system-ui, sans-serif;
  box-shadow: 0 1px 2px rgba(11,17,32,.08), 0 8px 24px -12px rgba(11,17,32,.25);
  display: flex; flex-direction: column;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.lp-sheet * { box-sizing: border-box; }
.lp-serif { font-family: var(--font-dmserif), Georgia, serif; font-weight: 400; }
.lp-tab { font-variant-numeric: tabular-nums; }
.lp-photo { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--canvas-deep); }
.lp-pill { display: inline-block; background: var(--blue); color: #fff; font-weight: 800; letter-spacing: .12em; border-radius: 1cqw; }
.lp-qr svg { display: block; width: 100%; height: auto; }
.lp-muted { color: var(--ink-45); }
.lp-band { background: var(--blue); color: #fff; }
.lp-hr { border: 0; border-top: .2cqw solid var(--line); margin: 0; }

/* Poster */
.lp-poster-photo { position: relative; height: 60cqw; flex: none; }
.lp-poster-photo .lp-pill { position: absolute; top: 4cqw; left: 5cqw; font-size: 3.4cqw; padding: 1.4cqw 2.8cqw; }
.lp-poster-body { flex: 1; min-height: 0; padding: 4.5cqw 5cqw 0; display: flex; flex-direction: column; gap: 1.6cqw; }
.lp-poster-headline { font-size: 7.2cqw; line-height: 1.08; margin: 0; }
.lp-poster-place { font-size: 3.4cqw; margin: 0; }
.lp-poster-price { font-size: 9cqw; font-weight: 800; color: var(--blue); line-height: 1.05; margin: .8cqw 0 0; }
.lp-poster-rooms { font-size: 3.6cqw; font-weight: 600; margin: 0; }
.lp-poster-terms { font-size: 2.8cqw; margin: 0; }
.lp-poster-foot { flex: none; display: grid; grid-template-columns: minmax(0,1fr) 31cqw; gap: 4cqw; align-items: end; padding: 3cqw 5cqw 4cqw; }
.lp-poster-cta { font-size: 3cqw; font-weight: 800; margin: 0 0 1cqw; }
.lp-poster-url { font-size: 2.6cqw; margin: 0 0 3cqw; word-break: break-all; }
.lp-poster-agent { font-size: 3.6cqw; font-weight: 800; margin: 0; }
.lp-poster-phone { font-size: 5.4cqw; font-weight: 800; color: var(--blue); margin: .4cqw 0 0; }
.lp-poster-ref { font-size: 2.6cqw; margin: 1.4cqw 0 0; }
.lp-brandbar { flex: none; display: flex; justify-content: space-between; align-items: center; padding: 2.2cqw 5cqw; font-size: 2.6cqw; font-weight: 700; }

/* Technical sheet — one A4 page (141.4cqw tall). Fixed parts: header ~22,
   figures ~8, contact ~17, brand bar ~5.5, paddings and gaps ~14. The PHOTOS
   are the flexible part: the details take their natural height and the
   gallery gets what is left, between 22cqw and 46cqw — a listing with ten
   points forts gets smaller photos instead of a second page. Only if the
   details would still not fit do they clip (never the contact block, which
   is pinned to the bottom). */
.lp-fiche-head { flex: none; padding: 3cqw 5cqw 3cqw; }
.lp-fiche-top { display: flex; justify-content: space-between; align-items: center; gap: 3cqw; }
.lp-logo { display: block; height: 3.8cqw; width: auto; }
.lp-fiche-ref { font-size: 1.8cqw; font-weight: 700; letter-spacing: .04em; opacity: .9; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.lp-fiche-headrow { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4cqw; align-items: end; margin-top: 2cqw; }
.lp-fiche-head .lp-pill { background: #fff; color: var(--blue); font-size: 1.7cqw; padding: .6cqw 1.6cqw; }
.lp-fiche-title { font-size: 4.2cqw; line-height: 1.1; margin: 1cqw 0 0; }
.lp-fiche-sub { font-size: 2cqw; margin: .6cqw 0 0; opacity: .88; }
.lp-fiche-price { font-size: 5cqw; font-weight: 800; line-height: 1; margin: 0; white-space: nowrap; }
.lp-fiche-main { flex: 1; min-height: 0; padding: 3cqw 5cqw 3cqw; display: flex; flex-direction: column; gap: 2.4cqw; }

.lp-gallery { position: relative; flex: 1 1 0; min-height: 22cqw; max-height: 46cqw; }
.lp-ph { position: absolute; overflow: hidden; border-radius: 1.2cqw; background: var(--canvas-deep); }
.lp-ph img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; }
.lp-g1 .lp-ph-hero { inset: 0; }
.lp-g2 .lp-ph-hero, .lp-g3 .lp-ph-hero { top: 0; bottom: 0; left: 0; width: calc(60% - .6cqw); }
.lp-g2 .lp-ph-side-1 { top: 0; bottom: 0; right: 0; width: calc(40% - .6cqw); }
.lp-g3 .lp-ph-side-1 { top: 0; right: 0; width: calc(40% - .6cqw); height: calc(50% - .6cqw); }
.lp-g3 .lp-ph-side-2 { bottom: 0; right: 0; width: calc(40% - .6cqw); height: calc(50% - .6cqw); }

.lp-specs { flex: none; display: grid; margin: 0; border: .2cqw solid var(--line); border-radius: 1.4cqw; overflow: hidden; }
.lp-spec { padding: 1.2cqw 1.8cqw; min-width: 0; }
.lp-spec + .lp-spec { border-left: .2cqw solid var(--line); }
.lp-spec dt { font-size: 1.5cqw; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.lp-spec dd { margin: .4cqw 0 0; font-size: 2.6cqw; font-weight: 800; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.lp-details { flex: 0 1 auto; min-height: 0; overflow: hidden; display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 4cqw; align-content: start; }
.lp-col { display: flex; flex-direction: column; gap: 2.2cqw; min-width: 0; }
.lp-block { min-width: 0; }
.lp-section-title { font-size: 2.2cqw; font-weight: 800; margin: 0 0 1cqw; color: var(--blue); text-transform: uppercase; letter-spacing: .05em; }
.lp-gap-top { margin-top: 2cqw; }
.lp-table { width: 100%; border-collapse: collapse; font-size: 1.75cqw; table-layout: fixed; }
.lp-table th { text-align: left; font-weight: 500; color: var(--ink-45); padding: .5cqw 1.5cqw .5cqw 0; width: 42%; vertical-align: top; }
.lp-table td { font-weight: 700; padding: .5cqw 0; vertical-align: top; overflow-wrap: anywhere; }
.lp-table tr + tr th, .lp-table tr + tr td { border-top: .15cqw solid var(--line); }
.lp-note { font-size: 1.45cqw; margin: .8cqw 0 0; }
.lp-list { margin: 0; padding: 0; list-style: none; font-size: 1.75cqw; line-height: 1.3; display: grid; gap: .7cqw; }
.lp-list li { padding-left: 2.4cqw; position: relative; }
.lp-list li::before { content: ''; position: absolute; left: 0; top: .75cqw; width: 1cqw; height: 1cqw; border-radius: 50%; background: var(--blue); }
.lp-map a { color: var(--blue-deep); font-weight: 700; }

.lp-contact { flex: none; margin-top: auto; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4cqw; align-items: center; border: .2cqw solid var(--line); border-radius: 1.6cqw; padding: 1.8cqw 2.4cqw; background: var(--canvas-alt, #f6f7fb); }
.lp-contact-label { font-size: 1.5cqw; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; margin: 0; }
.lp-contact-name { font-size: 2.6cqw; font-weight: 800; margin: .4cqw 0 0; }
.lp-contact-phone { font-size: 3.4cqw; font-weight: 800; color: var(--blue); margin: .3cqw 0 0; }
.lp-contact-url { font-size: 1.6cqw; margin: .8cqw 0 0; overflow-wrap: anywhere; }
.lp-qr-wrap { width: 12cqw; text-align: center; }
.lp-qr-wrap .lp-qr { background: #fff; border-radius: .8cqw; }
.lp-qr-caption { font-size: 1.3cqw; margin: .4cqw 0 0; }
.lp-fiche .lp-brandbar { padding: 1.6cqw 5cqw; font-size: 1.8cqw; }

@media print {
  @page { size: A4; margin: 0; }
  html, body { background: #fff !important; }
  body:has(.lp-print) aside,
  body:has(.lp-print) nav,
  body:has(.lp-print) header:not(.lp-fiche-head),
  body:has(.lp-print) .lp-screen-only { display: none !important; }
  body:has(.lp-print) .bg-canvas-alt { background: #fff !important; }
  body:has(.lp-print) .pb-16 { padding-bottom: 0 !important; }
  body:has(.lp-print) .min-h-screen { min-height: 0 !important; }
  .lp-print { display: block; padding: 0; gap: 0; }
  /* The printable width, whatever margins the browser adds (iPhone Safari
     keeps its own), minus half a millimetre: a sheet exactly as tall as the
     page rounds over it and prints a blank second page. The height follows
     A4's ratio, and every length inside is cqw, so the layout only scales. */
  .lp-sheet {
    width: calc(100% - .5mm); max-width: 209.5mm; height: auto; aspect-ratio: 210 / 297;
    margin: 0 auto; box-shadow: none;
    break-inside: avoid; page-break-inside: avoid;
    break-after: page; page-break-after: always;
  }
  .lp-sheet:last-child { break-after: auto; page-break-after: auto; }
}
`;

export default function PrintStyles() {
  // Static CSS string defined above, no user input.
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
