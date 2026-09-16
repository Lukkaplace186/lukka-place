'use client';

import { useState } from 'react';
import { Check, Copy, Download, MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { BUTTON } from '../styles';

/**
 * What a rep hands out: the code, the signup link, a QR code for field visits
 * and printed material, and two WhatsApp links — one to send the signup link
 * to an agent, one an agent taps to register with Lukka Place on WhatsApp with
 * the code already typed. The QR SVG is drawn on the server.
 */
export default function ReferralToolkit({ code, link, qrSvg, shareHref, onboardingHref }) {
  const t = useT();
  const [copied, setCopied] = useState(null);

  async function copy(value, which) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  const qrHref = qrSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}` : null;

  return (
    <div className="u-card grid gap-4 rounded-card bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <div className="u-eyebrow text-ink-45">{t('admin.sales.launch.referral.code')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="u-ref text-[1.375rem] font-bold tracking-wide text-ink">{code}</span>
            <button type="button" className={BUTTON} onClick={() => copy(code, 'code')}>
              {copied === 'code' ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
              {copied === 'code' ? t('admin.sales.launch.referral.copied') : t('admin.sales.launch.referral.copy')}
            </button>
          </div>
        </div>
        <div className="min-w-0">
          <div className="u-eyebrow text-ink-45">{t('admin.sales.launch.referral.link')}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="u-micro min-w-0 break-all text-ink-70">{link}</span>
            <button type="button" className={BUTTON} onClick={() => copy(link, 'link')}>
              {copied === 'link' ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
              {copied === 'link' ? t('admin.sales.launch.referral.copied') : t('admin.sales.launch.referral.copy')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={shareHref} target="_blank" rel="noopener noreferrer" className={BUTTON}>
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.launch.referral.shareWhatsApp')}
          </a>
          {onboardingHref ? (
            <button type="button" className={BUTTON} onClick={() => copy(onboardingHref, 'onboarding')}>
              {copied === 'onboarding' ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" /> : <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />}
              {copied === 'onboarding' ? t('admin.sales.launch.referral.copied') : t('admin.sales.launch.referral.copyOnboarding')}
            </button>
          ) : null}
        </div>
        <p className="u-micro text-ink-45">{t('admin.sales.launch.referral.hint')}</p>
      </div>
      {qrHref ? (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URI, nothing to optimise */}
          <img src={qrHref} alt={t('admin.sales.launch.referral.qrAlt', { code })} width={160} height={160} className="h-40 w-40 rounded-md border border-line bg-white" />
          <a href={qrHref} download={`lukka-place-${code}.svg`} className={BUTTON}>
            <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.sales.launch.referral.downloadQr')}
          </a>
        </div>
      ) : null}
    </div>
  );
}
