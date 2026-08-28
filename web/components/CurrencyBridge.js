import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import { getCdfRate } from '@/lib/currencyRate';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Diaspora block — makes the USD/CDF switch a headline feature rather than a
 * control tucked into the header.
 *
 * Honesty constraint: the rate is admin-editable (lib/currencyRate.js) but
 * still explicitly not a live FX feed — this section states the rate and
 * its real date outright instead of implying anything live, same discipline
 * <Price> already applies with its "≈" marker and tooltip. If this ever
 * moves to a real feed, this copy has to change with it. A Server Component
 * already, so it reads the rate directly rather than via
 * CurrencyRateContext (that context exists only because Price.js/
 * PropertyMap.js are 'use client' and can't do this themselves).
 */
export default async function CurrencyBridge() {
  const { cdfPerUsd, updatedAt } = await getCdfRate();

  return (
    <section className="bg-ink py-20 sm:py-28">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
          <div>
            <p className="u-eyebrow mb-4 text-blue-tint">Depuis l&apos;étranger</p>
            <h2 className="font-display text-[1.75rem] font-normal leading-[1.12] tracking-[-0.02em] text-white sm:text-[2.25rem]">
              Investir à Kinshasa, depuis n&apos;importe où
            </h2>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-white/70">
              Chaque prix s&apos;affiche en dollars ou en francs congolais d&apos;un simple geste, la carte situe le bien
              dans sa commune, et un message WhatsApp vous met en relation directement — sans intermédiaire, quel que
              soit votre fuseau horaire.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/listings"
                className="inline-flex items-center rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
              >
                Parcourir les biens
              </Link>
              <Link
                href="/a-propos"
                className="inline-flex items-center rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-white/60"
              >
                Comment ça marche
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue/20 text-blue-tint">
                <ArrowLeftRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
              </span>
              <p className="u-eyebrow text-white/50">Taux de référence</p>
            </div>

            <p className="mt-6 flex flex-wrap items-baseline gap-x-3 text-white">
              <span className="u-tabular text-2xl font-bold">1 USD</span>
              <span className="text-white/40">=</span>
              <span className="u-tabular text-2xl font-bold">{cdfPerUsd.toLocaleString('fr-FR')} FC</span>
            </p>

            <p className="mt-4 text-[0.8125rem] leading-relaxed text-white/50">
              Taux de référence relevé le {updatedAt}, mis à jour manuellement. Les prix des annonces
              sont établis en dollars — les montants en francs sont une estimation indicative, jamais le prix contractuel.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
