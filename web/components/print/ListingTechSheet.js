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

function Header({ sheet, compact = false }) {
  return (
    <header className="lp-fiche-head lp-band">
      {sheet.purposeLabel && <span className="lp-pill">{sheet.purposeLabel}</span>}
      {sheet.headline && <h1 className="lp-serif lp-fiche-title">{sheet.headline}</h1>}
      {!compact && sheet.place && <p className="lp-fiche-sub">{sheet.place}</p>}
      {!compact && <p className="lp-fiche-price lp-tab">{sheet.priceText}</p>}
      {sheet.reference && <p className="lp-fiche-sub">Réf. {sheet.reference}</p>}
    </header>
  );
}

function Footer({ page }) {
  return (
    <div className="lp-brandbar lp-band">
      <span>Fiche technique · Lukka Place</span>
      <span className="lp-page-no">{page} / 2</span>
    </div>
  );
}

function Gallery({ photos }) {
  if (!photos.length) return null;
  const [cover, ...rest] = photos;
  const side = rest.slice(0, 4);
  const sideClass = side.length === 1 ? 'lp-one' : side.length === 2 ? 'lp-two' : '';
  return (
    <div className={`lp-gallery${side.length ? '' : ' lp-single'}`}>
      <img className="lp-photo" src={cover} alt="" />
      {side.length > 0 && (
        <div className={`lp-gallery-side ${sideClass}`}>
          {side.map((src) => (
            <img key={src} className="lp-photo" src={src} alt="" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The two-page technical sheet (fiche technique). Page 1: photos, key facts
 * and the entry costs — deposit, advance and commission as three lines, never
 * a sum. Page 2: the agent's own features, the tagged amenities, the location
 * (quartier, commune, référence), a map link when a real coordinate exists,
 * and the contact. French content only; a section with nothing in it is not
 * printed.
 */
export default function ListingTechSheet({ sheet, qr }) {
  return (
    <>
      <section className="lp-sheet" aria-label="Fiche technique, page 1">
        <Header sheet={sheet} />
        <div className="lp-fiche-main">
          <Gallery photos={sheet.photos} />
          <div className="lp-cols">
            <div>
              <h2 className="lp-section-title">Caractéristiques</h2>
              <FactTable rows={sheet.keyFacts} />
            </div>
            {sheet.entryCosts.length > 0 && (
              <div>
                <h2 className="lp-section-title">Conditions d’entrée</h2>
                <FactTable rows={sheet.entryCosts} />
                <p className="lp-note lp-muted">Montants indiqués séparément, tels que déclarés par l’agent.</p>
              </div>
            )}
          </div>
        </div>
        <Footer page={1} />
      </section>

      <section className="lp-sheet" aria-label="Fiche technique, page 2">
        <Header sheet={sheet} compact />
        <div className="lp-fiche-main">
          {sheet.features.length > 0 && (
            <div>
              <h2 className="lp-section-title">Points forts</h2>
              <ul className={`lp-list${sheet.features.length > 6 ? ' lp-two-cols' : ''}`}>
                {sheet.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
          )}
          {sheet.amenities.length > 0 && (
            <div>
              <h2 className="lp-section-title">Équipements</h2>
              <ul className="lp-list lp-two-cols">
                {sheet.amenities.map((amenity) => (
                  <li key={amenity}>{amenity}</li>
                ))}
              </ul>
            </div>
          )}
          {(sheet.location.length > 0 || sheet.mapUrl) && (
            <div>
              <h2 className="lp-section-title">Emplacement</h2>
              {sheet.location.length > 0 && <FactTable rows={sheet.location} />}
              {sheet.mapUrl && (
                <p className="lp-map lp-note">
                  <a href={sheet.mapUrl}>Voir sur Google Maps</a>
                  <span className="lp-muted"> · {sheet.coordinates} (position indicative)</span>
                </p>
              )}
            </div>
          )}
          <div className="lp-contact">
            <div>
              <h2 className="lp-section-title">Contact</h2>
              {sheet.agentName && <p className="lp-contact-name">{sheet.agentName}</p>}
              {sheet.agentPhone && <p className="lp-contact-phone lp-tab">{sheet.agentPhone}</p>}
              <p className="lp-contact-url lp-muted">
                Photos et demande de visite : {sheet.displayUrl}
              </p>
            </div>
            {/* Inline SVG generated server-side by qrcode from our own URL */}
            <div className="lp-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          </div>
        </div>
        <Footer page={2} />
      </section>
    </>
  );
}
