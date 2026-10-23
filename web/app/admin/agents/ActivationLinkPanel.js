'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { activationShareHref } from '@/lib/adminAgentCreate';

/**
 * What the admin sees once an account is created or verified: how many
 * listings it now holds, and the single-use activation link to show or send.
 * "Envoyer sur WhatsApp" opens the ADMIN's own WhatsApp with the text typed
 * in — nothing is sent by Lukka Place. The link is shown once; a new one is
 * "Réinitialiser l'accès" on the agent's page.
 */
export default function ActivationLinkPanel({ result, showAgentLink = true }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const share = result.link ? activationShareHref(result) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success-tint p-4">
      <p className="u-micro-strong text-ink">
        {t('admin.agentCreate.verifiedDone', { phone: `+${result.phone}` })}{' '}
        {result.claimError ? t('admin.agentCreate.claimFailed') : t('admin.agentCreate.claimed', { count: result.claimed })}
      </p>
      {result.link ? (
        <>
          <p className="u-micro text-ink-70">{t('admin.agentCreate.linkHint')}</p>
          <input
            readOnly
            value={result.link}
            onFocus={(event) => event.currentTarget.select()}
            className="u-focus-ring u-tabular h-10 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue"
            >
              <Copy strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {copied ? t('admin.agentCreate.copied') : t('admin.agentCreate.copy')}
            </button>
            {share ? (
              <a
                href={share}
                target="_blank"
                rel="noopener noreferrer"
                className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue"
              >
                <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                {t('admin.agentCreate.sendFromMyWhatsApp')}
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <p className="u-micro text-ink-70">{t('admin.agentCreate.noLinkHasPassword')}</p>
      )}
      {showAgentLink ? (
        <Link href={`/admin/agents/${result.agentId}`} className="u-micro-strong text-blue-deep hover:underline">
          {t('admin.agentCreate.openAgent', { id: result.agentId })}
        </Link>
      ) : null}
    </div>
  );
}
