'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, MapPin, Calculator, BedDouble, Trash2, ChevronDown } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPhoneDisplay } from '@/lib/phone';
import AgentClientDialog from './AgentClientDialog';
import { ClientMatchList } from './AgentClientMatches';
import { deleteAgentClientAction } from '@/app/compte/agent/clientActions';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

function budgetLabel(client, t) {
  const fmt = (n) => `${Number(n).toLocaleString('fr-FR')} $`;
  if (client.budget_min != null && client.budget_max != null) return `${fmt(client.budget_min)} – ${fmt(client.budget_max)}`;
  if (client.budget_max != null) return t('agent.clients.budgetUpTo', { amount: fmt(client.budget_max) });
  if (client.budget_min != null) return t('agent.clients.budgetFrom', { amount: fmt(client.budget_min) });
  return null;
}

/**
 * One client in the agent's private book, with "N biens correspondent"
 * expanding to one WhatsApp tap per matching listing. `matches` is computed
 * server-side by lib/clientMatching.js at read time.
 */
export default function AgentClientCard({ client, matches, communes }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const budget = budgetLabel(client, t);

  function remove() {
    startTransition(async () => {
      let result;
      try {
        result = await deleteAgentClientAction(client.id);
      } catch (err) {
        console.error('[AgentClientCard] delete failed', err);
        result = { ok: false, error: t('errors.submissionFailed') };
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: t('agent.clients.deleted') });
      router.refresh();
    });
  }

  return (
    <div className="u-card rounded-card bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-bold text-ink">{client.name}</span>
            <span className="rounded-full bg-canvas-alt px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-ink-70">
              {t(`agent.clients.purpose.${client.transaction_type}`)}
            </span>
          </div>
          <div className="u-micro mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-ink-70">
            <span className="inline-flex items-center gap-1.5">
              <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
              {formatPhoneDisplay(client.phone)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" />
              <span className="truncate">{client.communes.length ? client.communes.join(', ') : t('agent.clients.anyCommune')}</span>
            </span>
            {budget && (
              <span className="inline-flex items-center gap-1.5">
                <Calculator strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                <span className="u-tabular">{budget}</span>
              </span>
            )}
            {client.bedrooms > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <BedDouble strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                {t('agent.clients.bedroomsAtLeast', { count: client.bedrooms })}
              </span>
            )}
          </div>
          {client.notes && <p className="mt-2 max-w-[72ch] whitespace-pre-line text-sm text-ink-70">{client.notes}</p>}
        </div>

        <div className="flex items-center gap-1">
          <AgentClientDialog communes={communes} client={client} />
          {confirming ? (
            <>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="u-press h-10 rounded-lg bg-danger px-3 text-[0.8125rem] font-bold text-white disabled:opacity-60"
              >
                {t('agent.clients.confirmDelete')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="u-press h-10 rounded-lg px-3 text-[0.8125rem] font-semibold text-ink-45 hover:bg-canvas-alt"
              >
                {t('common.actions.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={t('agent.clients.delete')}
              className="u-press grid h-10 w-10 place-items-center rounded-lg text-ink-45 hover:bg-danger-tint hover:text-danger"
            >
              <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        {matches.length === 0 ? (
          <p className="u-micro text-ink-45">{t('agent.clients.noMatches')}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="u-press inline-flex min-h-10 items-center gap-1.5 rounded-full bg-blue-tint px-3 text-[0.8125rem] font-bold text-blue-deep"
            >
              {t('agent.clients.clientMatches', { count: matches.length })}
              <ChevronDown
                strokeWidth={ICON_STROKE_WIDTH}
                className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>
            {expanded && (
              <div className="mt-2">
                <ClientMatchList
                  entries={matches}
                  labelOf={(e) => e.title}
                  detailOf={(e) => [e.price, e.place].filter(Boolean).join(' · ')}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
