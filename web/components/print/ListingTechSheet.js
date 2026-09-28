/* eslint-disable @next/next/no-img-element -- print pages: a plain <img> of an
   already-optimised /_next/image URL prints at the size the sheet gives it. */

function FactTable({ rows }) {
  return (
    <table className="lp-table">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td className="lp-tab">
              {row.value}
              {row.amount && <span className="lp-muted"> · {row.amount}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Hero on the left (60%), up to two photos stacked on the right. Every photo
 * box is absolutely positioned inside a fixed-height frame and the image
 * fills it with `object-fit: cover`: no percentage heights resolved through
 * a grid, which iPhone Safari got wrong — the side photos grew to their own
 * height and covered "Conditions d'entrée" (2026-09-28 screenshots).
 */
function Gallery({ photos }) {
  if (!photos.length) return null;
  const [cover, ...rest] = photos;
  const side = rest.slice(0, 2);
  const layout = side.length === 0 ? 'lp-g1' : side.length === 1 ? 'lp-g2' : 'lp-g3';
  return (
    <div className={`lp-gallery ${layout}`}>
      <div className="lp-ph lp-ph-hero">
        <img src={cover} alt="" />
      </div>
      {side.map((src, i) => (
        <div key={src} className={`lp-ph lp-ph-side lp-ph-side-${i + 1}`}>
          <img src={src} alt="" />
        </div>
      ))}
    </div>
  );
}

function BulletList({ items }) {
  return (
    <ul className="lp-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * The technical sheet (fiche technique) — ONE A4 page (it was two, the second
 * mostly empty and repeating the header). Top to bottom: header band (brand,
 * reference, purpose, headline, price), photos, the big-figure strip, then two
 * columns — entry costs and location on the left, the agent's points forts and
 * the tagged equipment on the right — and the contact block with the QR code.
 *
 * Entry costs stay three lines (deposit, advance, commission), never a sum.
 * French content only; a section with nothing in it is not printed. The
 * details area is the only part that flexes: the lists are capped in
 * lib/marketing/printSheet.js so they fit, and anything past the page is
 * clipped by the sheet rather than spilling onto a second sheet.
 */
export default function ListingTechSheet({ sheet, qr }) {
  const hasHighlights = sheet.sheetFeatures.length > 0 || sheet.sheetAmenities.length > 0;
  const hasLocation = sheet.location.length > 0 || Boolean(sheet.mapUrl);

  const conditions = sheet.entryCosts.length > 0 && (
    <div className="lp-block">
      <h2 className="lp-section-title">Conditions d’entrée</h2>
      <FactTable rows={sheet.entryCosts} />
      <p className="lp-note lp-muted">Montants indiqués séparément, tels que déclarés par l’agent.</p>
    </div>
  );
  const location = hasLocation && (
    <div className="lp-block">
      <h2 className="lp-section-title">Emplacement</h2>
      {sheet.location.length > 0 && <FactTable rows={sheet.location} />}
      {sheet.mapUrl && (
        <p className="lp-map lp-note">
          <a href={sheet.mapUrl}>Voir sur Google Maps</a>
          <span className="lp-muted"> · {sheet.coordinates} (position indicative)</span>
        </p>
      )}
    </div>
  );
  const amenitiesTitleClass = sheet.sheetFeatures.length > 0 ? 'lp-section-title lp-gap-top' : 'lp-section-title';
  const highlights = hasHighlights && (
    <div className="lp-block">
      {sheet.sheetFeatures.length > 0 && (
        <>
          <h2 className="lp-section-title">Points forts</h2>
          <BulletList items={sheet.sheetFeatures} />
        </>
      )}
      {sheet.sheetAmenities.length > 0 && (
        <>
          <h2 className={amenitiesTitleClass}>Équipements</h2>
          <BulletList items={sheet.sheetAmenities} />
        </>
      )}
    </div>
  );

  // Points forts get their own column when there are any; otherwise the
  // conditions and the location sit side by side.
  const columns = hasHighlights
    ? [[conditions, location], [highlights]]
    : [[conditions], [location]];

  return (
    <section className="lp-sheet lp-fiche" aria-label="Fiche technique">
      <header className="lp-fiche-head lp-band">
        <div className="lp-fiche-top">
          <img className="lp-logo" src="/brand/logo-dark.png" alt="Lukka Place" />
          {sheet.reference && <span className="lp-fiche-ref">Réf. {sheet.reference}</span>}
        </div>
        <div className="lp-fiche-headrow">
          <div className="lp-fiche-headtext">
            {sheet.purposeLabel && <span className="lp-pill">{sheet.purposeLabel}</span>}
            {sheet.headline && <h1 className="lp-serif lp-fiche-title">{sheet.headline}</h1>}
            {sheet.place && <p className="lp-fiche-sub">{sheet.place}</p>}
          </div>
          <p className="lp-fiche-price lp-tab">{sheet.priceText}</p>
        </div>
      </header>

      <div className="lp-fiche-main">
        <Gallery photos={sheet.photos} />

        {sheet.specs.length > 0 && (
          <dl className="lp-specs" style={{ gridTemplateColumns: `repeat(${sheet.specs.length}, minmax(0, 1fr))` }}>
            {sheet.specs.map((spec) => (
              <div key={spec.label} className="lp-spec">
                <dt className="lp-muted">{spec.label}</dt>
                <dd className="lp-tab">{spec.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="lp-details">
          {columns.map((blocks, i) => (
            <div key={i} className="lp-col">
              {blocks}
            </div>
          ))}
        </div>

        <div className="lp-contact">
          <div className="lp-contact-text">
            <p className="lp-contact-label lp-muted">Contact</p>
            {sheet.agentName && <p className="lp-contact-name">{sheet.agentName}</p>}
            {sheet.agentPhone && <p className="lp-contact-phone lp-tab">{sheet.agentPhone}</p>}
            <p className="lp-contact-url lp-muted">Photos et demande de visite : {sheet.displayUrl}</p>
          </div>
          <div className="lp-qr-wrap">
            {/* Inline SVG generated server-side by qrcode from our own URL */}
            <div className="lp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="lp-qr-caption lp-muted">Scannez pour voir l’annonce</p>
          </div>
        </div>
      </div>

      <div className="lp-brandbar lp-band">
        <span>Fiche technique · Lukka Place</span>
        <span>lukkaplace.com</span>
      </div>
    </section>
  );
}
