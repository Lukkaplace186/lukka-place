'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Banknote, Check, Copy, Link2, QrCode } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const ICON_BUTTON =
  'u-press inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink-70 hover:border-blue hover:text-ink disabled:opacity-40';

/**
 * The field shortcuts on one rep's row: copy their code, copy their link,
 * download their QR code, and — for `sales.manage` — pay this fortnight
 * (opens the rep's ledger filtered to the current fortnight's approved lines,
 * with the payout dialog already open).
 */
export default function RepRowActions({ repId, code, link, payHref, canManage }) {
  const t = useT();
  const [copied, setCopied] = useState(null);

  async function copy(value, which) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied(null);
    }
  }

  if (!code) {
    return <span className="u-micro text-ink-45">{t('admin.sales.team.noCode')}</span>;
  }

  return (
    <div className="flex items-center gap-1">
      <button type="button" className={ICON_BUTTON} onClick={() => copy(code, 'code')} title={t('admin.sales.team.copyCode', { code })} aria-label={t('admin.sales.team.copyCode', { code })}>
        {copied === 'code' ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
      </button>
      <button type="button" className={ICON_BUTTON} onClick={() => copy(link, 'link')} title={t('admin.sales.team.copyLink')} aria-label={t('admin.sales.team.copyLink')}>
        {copied === 'link' ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" /> : <Link2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
      </button>
      <a href={`/admin/sales/${repId}/qr?format=png`} className={ICON_BUTTON} title={t('admin.sales.team.downloadQr')} aria-label={t('admin.sales.team.downloadQr')}>
        <QrCode strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
      </a>
      {canManage ? (
        <Link href={payHref} className={ICON_BUTTON} title={t('admin.sales.team.pay')} aria-label={t('admin.sales.team.pay')}>
          <Banknote strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}
