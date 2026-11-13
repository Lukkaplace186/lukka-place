'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Handshake } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { setPartnerAgencyAction } from './partnerActions';

/** "Marquer comme partenaire" / "Retirer des partenaires" on an agency's page. */
export default function PartnerToggle({ vendorId, partner }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title={t('admin.agencies.partner.hint')}
      onClick={() => startTransition(async () => {
        let result;
        try {
          result = await setPartnerAgencyAction(vendorId, !partner);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
        showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
        if (result?.ok) router.refresh();
      })}
      className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50"
    >
      <Handshake strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      {t(partner ? 'admin.agencies.partner.remove' : 'admin.agencies.partner.mark')}
    </button>
  );
}
