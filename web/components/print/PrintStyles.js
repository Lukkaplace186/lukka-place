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
 * breaks after each sheet. `print-color-adjust: exact` keeps the blue band —
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

/* Technical sheet */
.lp-fiche-head { flex: none; padding: 4.5cqw 5cqw 4cqw; }
.lp-fiche-head .lp-pill { background: #fff; color: var(--blue); font-size: 2.4cqw; padding: .9cqw 2cqw; }
.lp-fiche-title { font-size: 5.6cqw; line-height: 1.1; margin: 1.8cqw 0 0; }
.lp-fiche-sub { font-size: 2.8cqw; margin: 1cqw 0 0; opacity: .88; }
.lp-fiche-price { font-size: 6cqw; font-weight: 800; margin: 1.6cqw 0 0; }
.lp-fiche-main { flex: 1; min-height: 0; padding: 4cqw 5cqw 0; display: flex; flex-direction: column; gap: 3.6cqw; }
.lp-gallery { display: grid; grid-template-columns: 2fr 1fr; gap: 1.2cqw; height: 50cqw; flex: none; }
.lp-gallery.lp-single { grid-template-columns: 1fr; }
.lp-gallery-side { display: grid; grid-template-rows: repeat(2, minmax(0,1fr)); grid-template-columns: repeat(2, minmax(0,1fr)); gap: 1.2cqw; min-height: 0; }
.lp-gallery-side.lp-one { grid-template-rows: 1fr; grid-template-columns: 1fr; }
.lp-gallery-side.lp-two { grid-template-columns: 1fr; }
.lp-gallery img { border-radius: 1.2cqw; min-height: 0; }
.lp-section-title { font-size: 3.6cqw; margin: 0 0 1.6cqw; color: var(--ink); }
.lp-table { width: 100%; border-collapse: collapse; font-size: 2.8cqw; }
.lp-table th { text-align: left; font-weight: 500; color: var(--ink-45); padding: 1.1cqw 0; width: 42%; vertical-align: top; }
.lp-table td { font-weight: 700; padding: 1.1cqw 0; vertical-align: top; }
.lp-table tr + tr th, .lp-table tr + tr td { border-top: .2cqw solid var(--line); }
.lp-cols { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 5cqw; }
.lp-note { font-size: 2.2cqw; margin: 1.2cqw 0 0; }
.lp-list { margin: 0; padding: 0; list-style: none; font-size: 2.8cqw; display: grid; gap: 1cqw; }
.lp-list li { padding-left: 3cqw; position: relative; }
.lp-list li::before { content: ''; position: absolute; left: 0; top: 1.1cqw; width: 1.2cqw; height: 1.2cqw; border-radius: 50%; background: var(--blue); }
.lp-list.lp-two-cols { grid-template-columns: repeat(2, minmax(0,1fr)); column-gap: 4cqw; }
.lp-map a { color: var(--blue-deep); font-weight: 700; font-size: 2.8cqw; }
.lp-contact { display: grid; grid-template-columns: minmax(0,1fr) 22cqw; gap: 4cqw; align-items: center; border: .25cqw solid var(--line); border-radius: 2cqw; padding: 3cqw 3.6cqw; }
.lp-contact-name { font-size: 3.4cqw; font-weight: 800; margin: 0; }
.lp-contact-phone { font-size: 4.2cqw; font-weight: 800; color: var(--blue); margin: .6cqw 0 0; }
.lp-contact-url { font-size: 2.4cqw; margin: 1.4cqw 0 0; word-break: break-all; }
.lp-page-no { font-size: 2.2cqw; }

@media print {
  @page { size: A4; margin: 0; }
  html, body { background: #fff !important; }
  body:has(.lp-print) aside,
  body:has(.lp-print) nav,
  body:has(.lp-print) .lp-screen-only { display: none !important; }
  body:has(.lp-print) .bg-canvas-alt { background: #fff !important; }
  body:has(.lp-print) .pb-16 { padding-bottom: 0 !important; }
  body:has(.lp-print) .min-h-screen { min-height: 0 !important; }
  .lp-print { display: block; padding: 0; gap: 0; }
  .lp-sheet { width: 210mm; height: 297mm; aspect-ratio: auto; box-shadow: none; break-after: page; page-break-after: always; }
  .lp-sheet:last-child { break-after: auto; page-break-after: auto; }
}
`;

export default function PrintStyles() {
  // Static CSS string defined above, no user input.
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
