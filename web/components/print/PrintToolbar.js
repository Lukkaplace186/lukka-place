'use client';

import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { recordListingSharesAction } from '@/app/compte/agent/shareActions';
import { useT } from '@/lib/i18n/client';

/**
 * The screen-only bar above a print page: back to Mes biens and "Imprimer /
 * PDF" (window.print(), which is also how a phone saves a PDF). Pressing it
 * records one `print` share (lib/listingShareRules.js), fire-and-forget and
 * before the dialog opens, so a slow network never delays printing. Printing
 * with Ctrl+P is not counted — only our own button is.
 */
export default function PrintToolbar({ listingId, medium, variant = null, canPrint, note = null }) {
  const t = useT();

  function handlePrint() {
    const format = medium === 'fiche' && variant === 'neutre' ? 'fiche_neutre' : medium;
    recordListingSharesAction({ listingIds: [listingId], channel: 'print', format }).catch(() => {});
    window.print();
  }

  return (
    <div className="lp-screen-only sticky top-0 z-20 border-b border-line bg-surface px-3 py-2.5 sm:px-8">
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2">
        <Link
          href="/compte/agent/biens"
          className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-ink-70 hover:bg-canvas-alt"
        >
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.print.back')}
        </Link>
        {variant && (
          <div role="radiogroup" aria-label={t('agent.print.variantLabel')} className="inline-flex rounded-full bg-canvas-alt p-1">
            {['complete', 'neutre'].map((key) => (
              <Link
                key={key}
                role="radio"
                aria-checked={variant === key}
                href={`/compte/agent/biens/${listingId}/fiche${key === 'neutre' ? '?variant=neutre' : ''}`}
                replace
                className={`inline-flex min-h-9 items-center rounded-full px-3 text-[0.8125rem] font-semibold ${variant === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-70'}`}
              >
                {t(`agent.print.variant.${key}`)}
              </Link>
            ))}
          </div>
        )}
        {canPrint && (
          <button
            type="button"
            onClick={handlePrint}
            className="u-btn-primary u-press inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-bold text-white"
          >
            <Printer strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('agent.print.printButton')}
          </button>
        )}
      </div>
      {note && <p className="mx-auto mt-2 max-w-[210mm] text-xs text-ink-45">{note}</p>}
      {variant === 'neutre' && <p className="mx-auto mt-2 max-w-[210mm] text-xs text-ink-45">{t('agent.print.neutralNote')}</p>}
    </div>
  );
}
