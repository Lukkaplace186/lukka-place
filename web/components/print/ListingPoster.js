/* eslint-disable @next/next/no-img-element -- print pages: a plain <img> of an
   already-optimised /_next/image URL prints at the size the sheet gives it. */

/**
 * The A4 window poster — one page, for a shop window or a plot gate.
 * French content only (lib/marketing/printSheet.js). Every block renders only
 * when its field is real; `qr` is inline SVG markup from our own qrcode call.
 */
export default function ListingPoster({ sheet, qr }) {
  const terms = sheet.entryCosts.map((line) => `${line.label} : ${line.value}`).join(' · ');
  return (
    <section className="lp-sheet" aria-label="Affiche A4">
      <div className="lp-poster-photo">
        {sheet.cover && <img className="lp-photo" src={sheet.cover} alt="" />}
        {sheet.purposeLabel && <span className="lp-pill">{sheet.purposeLabel}</span>}
      </div>

      <div className="lp-poster-body">
        {sheet.headline && <h1 className="lp-serif lp-poster-headline">{sheet.headline}</h1>}
        {sheet.place && <p className="lp-poster-place lp-muted">{sheet.place}</p>}
        <p className="lp-poster-price lp-tab">{sheet.priceText}</p>
        {sheet.rooms.length > 0 && <p className="lp-poster-rooms">{sheet.rooms.join(' · ')}</p>}
        {terms && <p className="lp-poster-terms lp-muted">{terms}</p>}
      </div>

      <div className="lp-poster-foot">
        <div>
          <p className="lp-poster-cta">Scannez pour voir les photos et demander une visite</p>
          <p className="lp-poster-url lp-muted">{sheet.displayUrl}</p>
          {sheet.agentName && <p className="lp-poster-agent">{sheet.agentName}</p>}
          {sheet.agentPhone && <p className="lp-poster-phone lp-tab">{sheet.agentPhone}</p>}
          {sheet.reference && <p className="lp-poster-ref lp-muted">Réf. {sheet.reference}</p>}
        </div>
        {/* Inline SVG generated server-side by qrcode from our own URL */}
        <div className="lp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
      </div>

      <div className="lp-brandbar lp-band">
        <span>Lukka Place</span>
        <span>lukkaplace.com</span>
      </div>
    </section>
  );
}
