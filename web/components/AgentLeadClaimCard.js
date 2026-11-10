'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Home, Target, Lock, Check, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';
import { answerLeadMatchAction } from '@/app/compte/agent/actions';

/**
 * A request the matching sent this agency, not taken yet (2026-11-10, engine
 * services/leadClaims.js). The customer's name and number are withheld by the
 * engine until the agency taps "Je m'en occupe" — the same two answers as the
 * WhatsApp alert's buttons. Up to 3 agencies may take one request; once 3
 * have, the card says so and offers nothing.
 */
const PRIMARY = 'u-press inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-[0.9375rem] font-bold';

export default function AgentLeadClaimCard({ lead, relativeTime, budget, target, highlighted = false }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [answered, setAnswered] = useState(null);
  const match = lead.my_match || {};
  const declined = answered === 'pass' || (!!match.declined_at && answered !== 'claim');
  const full = !!match.full;
  const waveKey = { 1: 'agent.leads.claim.wave1', 2: 'agent.leads.claim.wave2', 3: 'agent.leads.claim.wave3' }[match.wave];

  function answer(choice) {
    startTransition(async () => {
      try {
        const out = await answerLeadMatchAction(lead.id, choice);
        if (out.outcome === 'full') {
          showToast({ type: 'error', message: t('agent.leads.claim.full', { max: match.max_claims || 3 }) });
        } else if (!out.ok) {
          showToast({ type: 'error', message: t('errors.submissionFailed') });
          return;
        } else {
          setAnswered(choice);
          showToast({ type: 'success', message: t(choice === 'claim' ? 'agent.leads.claim.claimedToast' : 'agent.leads.claim.passedToast') });
        }
        router.refresh();
      } catch (err) {
        console.error('[AgentLeadClaimCard] answer failed', err);
        showToast({ type: 'error', message: t('errors.submissionFailed') });
      }
    });
  }

  return (
    <article className={`u-card rounded-card bg-surface p-4 sm:p-5 ${highlighted ? 'ring-2 ring-blue' : ''}`}>
      {highlighted && (
        <p className="u-micro-strong mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1 text-blue-deep">
          <Target strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('agent.leads.fromWhatsAppAlert')}
        </p>
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-ink">{t('agent.leads.claim.newRequest')}</p>
          <p className="text-xs text-ink-45">
            {t('agent.inbox.kind.enquiry')} · {relativeTime}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-blue px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-white">
          {t('agent.leads.claim.takers', { count: match.claims || 0, max: match.max_claims || 3 })}
        </span>
      </header>

      <div className="mt-3 flex flex-col gap-1.5">
        {lead.requirements_summary && (
          <p className="line-clamp-3 text-[0.9375rem] font-semibold leading-snug text-ink">{lead.requirements_summary}</p>
        )}
        {target && (
          <p className="flex min-w-0 items-center gap-2 text-sm text-ink-70">
            <Home strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" aria-hidden="true" />
            <span className="truncate">{target}</span>
          </p>
        )}
        {budget && (
          <p className="flex items-center gap-2 text-sm text-ink-70">
            <Calculator strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" aria-hidden="true" />
            {budget}
          </p>
        )}
        {match.neighbour_of && (
          <p className="text-sm text-ink-70">{t('agent.leads.claim.neighbour', { commune: match.neighbour_of })}</p>
        )}
        {waveKey && !full && <p className="text-sm text-ink-70">{t(waveKey)}</p>}
      </div>

      {full ? (
        <p className="mt-4 rounded-lg bg-canvas-alt p-3 text-sm font-semibold text-ink-70">
          {t('agent.leads.claim.full', { max: match.max_claims || 3 })}
        </p>
      ) : (
        <>
          <p className="mt-4 flex items-start gap-2 text-xs text-ink-45">
            <Lock strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {declined ? t('agent.leads.claim.declined') : t('agent.leads.claim.hiddenCustomer')}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => answer('claim')}
              className={`${PRIMARY} bg-blue text-white hover:brightness-110 disabled:opacity-60`}
            >
              <Check strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0" />
              <span className="truncate">{t('agent.leads.claim.claim')}</span>
            </button>
            {!declined && (
              <button
                type="button"
                disabled={pending}
                onClick={() => answer('pass')}
                className={`${PRIMARY} text-ink-70 ring-1 ring-inset ring-ink-25 hover:bg-canvas-alt hover:text-ink disabled:opacity-60`}
              >
                <X strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0" />
                <span className="truncate">{t('agent.leads.claim.pass')}</span>
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}
