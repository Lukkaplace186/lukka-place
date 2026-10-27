'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import AgentPicker from '../../AgentPicker';
import { adminAssignListingAgentAction } from '../createActions';

/**
 * "Agent / Commissionnaire" on the listing's page: who the listing belongs to,
 * and a picker to attach it to another agent or to none (orphan listings sent
 * before their agent had an account, or typed by the team).
 */
export default function ListingAgentCard({ listingId, current }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [choice, setChoice] = useState(current);
  const [pending, startTransition] = useTransition();
  const changed = (choice?.id ?? null) !== (current?.id ?? null);

  function save() {
    startTransition(async () => {
      let result;
      try {
        result = await adminAssignListingAgentAction(listingId, choice?.id ?? null);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error || t('errors.actionFailed') });
      if (result?.ok) router.refresh();
    });
  }

  return (
    <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
      <h2 className="u-title-card text-ink">{t('admin.listings.agentTitle')}</h2>
      {current ? (
        <Link href={`/admin/agents/${current.id}`} className="u-micro-strong text-blue-deep hover:underline">
          {current.name} · #{current.id}
        </Link>
      ) : (
        <p className="u-micro text-danger">{t('admin.listings.noAgent')}</p>
      )}
      <AgentPicker defaultAgent={current} allowClear onSelect={setChoice} placeholder={t('admin.agentPanel.chooseAgent')} />
      {changed ? (
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="u-btn-primary u-press inline-flex h-9 items-center justify-center gap-1.5 self-start rounded-lg px-3 text-sm font-bold disabled:opacity-50"
        >
          <UserCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {choice ? t('admin.listings.assignAgent') : t('admin.listings.removeAgent')}
        </button>
      ) : null}
    </section>
  );
}
