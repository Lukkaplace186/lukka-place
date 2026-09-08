import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import { getCdfRate } from '@/lib/currencyRate';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

/**
 * Diaspora block — makes the USD/CDF switch a headline feature rather than a
 * control tucked into the header.
 *
 * Honesty constraint: the rate now comes from a real daily feed
 * (lib/exchangeRate.js, via lib/currencyRate.js), so the old "mis à jour
 * manuellement" wording here was retired with it — web/CLAUDE.md required
 * exactly that if this ever moved to a live source. What the copy still
 * refuses to do is imply a dealing rate: it states the figure and the real
 * date the figure is FROM (live publish date, admin entry, or the dated
 * fallback — whichever actually supplied it), same discipline <Price>
 * applies with its "≈" marker and tooltip. A Server Component
 * already, so it reads the rate directly rather than via
 * CurrencyRateContext (that context exists only because Price.js/
 * PropertyMap.js are 'use client' and can't do this themselves).
 */
export default async function CurrencyBridge() {
  const t = await getT();
  const { cdfPerUsd, updatedAt } = await getCdfRate();

  return (
    <section className="bg-ink py-20 sm:py-28">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
          <div>
            <p className="u-eyebrow mb-4 text-blue-tint">{t('home.currencyBridge.eyebrow')}</p>
            <h2 className="font-display text-[1.75rem] font-normal leading-[1.12] tracking-[-0.02em] text-white sm:text-[2.25rem]">
              Investir à Kinshasa, depuis n&apos;importe où
            </h2>
            <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-white/70">
              Chaque prix s&apos;affiche en dollars ou en francs congolais d&apos;un simple geste, la carte situe le bien
              {t('home.currencyBridge.body')}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/listings"
                className="inline-flex items-center rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-deep u-btn-primary"
              >
                {t('home.currencyBridge.browse')}
              </Link>
              <Link
                href="/a-propos"
                className="inline-flex items-center rounded-full border border-white/25 px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-white/60"
              >
                {t('home.currencyBridge.howItWorks')}
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue/20 text-blue-tint">
                <ArrowLeftRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
              </span>
              <p className="u-eyebrow text-white/50">{t('home.currencyBridge.referenceRate')}</p>
            </div>

            <p className="mt-6 flex flex-wrap items-baseline gap-x-3 text-white">
              <span className="u-tabular text-2xl font-bold">1 USD</span>
              <span className="text-white/40">=</span>
              <span className="u-tabular text-2xl font-bold">{cdfPerUsd.toLocaleString('fr-FR')} FC</span>
            </p>

            <p className="mt-4 text-[0.8125rem] leading-relaxed text-white/50">
              Taux de référence du {updatedAt}, à titre indicatif. Les prix des annonces
              {t('home.currencyBridge.rateNote')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
