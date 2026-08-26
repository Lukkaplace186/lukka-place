import Link from 'next/link';
import SafeImage from './SafeImage';
import SectionHeading from './SectionHeading';

/**
 * "Explorez par commune" — real photography, real counts.
 *
 * Each tile shows a photo of an actual approved listing in that commune
 * (getCommuneShowcase in lib/listings.js) and that commune's real
 * approved-listing count. The previous version used flat CSS gradients
 * precisely because no commune-specific photography existed and a stock
 * photo captioned "Gombe" would have been a fabrication — this is the honest
 * way to get real imagery onto the page, since the photo genuinely is a
 * property in the commune it is labelled with.
 *
 * A commune whose latest listing has no usable photo falls back to the
 * typographic treatment rather than borrowing another commune's image.
 */
export default function ExploreCommunes({ communes = [] }) {
  if (!communes.length) return null;

  return (
    <section className="bg-canvas-alt py-20 sm:py-28">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Quartiers"
          title="Explorez par commune"
          lead="Les communes de Kinshasa où des biens sont disponibles en ce moment."
          href="/listings"
          linkLabel="Toutes les annonces"
          className="mb-10"
        />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {communes.map(({ commune, count, image }) => (
            <Link
              key={commune}
              href={`/listings?commune=${encodeURIComponent(commune)}`}
              className="group relative flex h-48 flex-col justify-end overflow-hidden rounded-lg bg-ink sm:h-60"
            >
              {image ? (
                <>
                  <SafeImage
                    src={image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 33vw, 50vw"
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120]/85 via-[#0B1120]/25 to-transparent" />
                </>
              ) : (
                <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-ink to-blue" />
              )}

              <div className="relative z-10 p-4 sm:p-5">
                <h3 className="font-display text-xl leading-tight tracking-[-0.01em] text-white sm:text-2xl">{commune}</h3>
                <p className="mt-1 text-[0.8125rem] text-white/70">
                  <span className="u-tabular font-semibold text-white">{count}</span>{' '}
                  {count === 1 ? 'bien disponible' : 'biens disponibles'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
