'use client';

import { useState } from 'react';
import { Check, Copy, Download, MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { partnerLinks } from '@/lib/partnerRules';
import { BUTTON, INPUT } from '../../sales/styles';

/**
 * What a partner hands out: the code, the bio link, the invite page, a link
 * per listing (one per TikTok video or post, so each is counted apart), and
 * the QR code. The QR SVG is drawn on the server; the files come from
 * ./qr/route.js.
 */
export default function PartnerToolkit({ partnerId, code, siteUrl, qrSvg }) {
  const t = useT();
  const [copied, setCopied] = useState(null);
  const [listingId, setListingId] = useState('');
  const links = partnerLinks(code, { siteUrl, listingId });

  async function copy(value, which) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  const copyButton = (value, which) => (
    <button type="button" className={BUTTON} onClick={() => copy(value, which)} disabled={!value}>
      {copied === which ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
      {copied === which ? t('admin.partners.toolkit.copied') : t('admin.partners.toolkit.copy')}
    </button>
  );

  const row = (label, value, which, hint = null) => (
    <div className="min-w-0">
      <div className="u-eyebrow text-ink-45">{label}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="u-micro min-w-0 break-all text-ink-70">{value}</span>
        {copyButton(value, which)}
      </div>
      {hint ? <p className="u-micro mt-1 text-ink-45">{hint}</p> : null}
    </div>
  );

  const qrHref = qrSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}` : null;
  const shareText = t('admin.partners.toolkit.shareText', { link: links.invite });

  return (
    <div className="u-card grid gap-4 rounded-card bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <div className="u-eyebrow text-ink-45">{t('admin.partners.toolkit.code')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="u-ref text-[1.375rem] font-bold tracking-wide text-ink">{code}</span>
            {copyButton(code, 'code')}
          </div>
        </div>
        {row(t('admin.partners.toolkit.bioLink'), links.home, 'home', t('admin.partners.toolkit.bioHint'))}
        {row(t('admin.partners.toolkit.inviteLink'), links.invite, 'invite', t('admin.partners.toolkit.inviteHint'))}
        <div className="min-w-0">
          <div className="u-eyebrow text-ink-45">{t('admin.partners.toolkit.listingLink')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              value={listingId}
              onChange={(event) => setListingId(event.target.value.replace(/\D/g, '').slice(0, 9))}
              inputMode="numeric"
              placeholder={t('admin.partners.toolkit.listingPlaceholder')}
              aria-label={t('admin.partners.toolkit.listingPlaceholder')}
              className={`${INPUT} w-36`}
            />
            {links.listing ? <span className="u-micro min-w-0 break-all text-ink-70">{links.listing}</span> : null}
            {copyButton(links.listing, 'listing')}
          </div>
          <p className="u-micro mt-1 text-ink-45">{t('admin.partners.toolkit.listingHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className={BUTTON}>
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.partners.toolkit.shareWhatsApp')}
          </a>
        </div>
      </div>
      {qrHref ? (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI, nothing to optimise */}
          <img src={qrHref} alt={t('admin.partners.toolkit.qrAlt', { code })} width={160} height={160} className="h-40 w-40 rounded-md border border-line bg-white" />
          <div className="flex gap-1.5">
            <a href={`/admin/partenaires/${partnerId}/qr?format=png`} className={BUTTON}>
              <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> PNG
            </a>
            <a href={`/admin/partenaires/${partnerId}/qr?format=svg`} className={BUTTON}>
              <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> SVG
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
