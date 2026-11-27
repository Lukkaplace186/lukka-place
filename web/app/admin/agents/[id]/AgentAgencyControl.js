'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Check, Search } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { reassignAgentVendorAction, searchAgenciesForAgentAction } from '../actions';

const BUTTON =
  'u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';
const SMALL_BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center rounded-md border border-line bg-surface px-2.5 text-ink hover:border-blue disabled:opacity-50';
const PRIMARY =
  'u-press u-btn-primary inline-flex h-8 items-center rounded-md bg-blue px-3 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50';

/**
 * "Changer d'agence" on the agent's profile: search an agency by its name, an
 * agent's name or a number, pick it, confirm. Same write as the agents list's
 * dialog (`reassignAgentVendorAction`). When the move empties the agency the
 * agent came from — usually the one created with the account — the dialog says
 * so and links to it, since it is left behind with its own plan.
 */
export default function AgentAgencyControl({ agentId, agentName, currentVendorId, currentVendorName }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ term: '', agencies: [], error: null });
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [leftBehind, setLeftBehind] = useState(null);
  const [pending, startTransition] = useTransition();

  const term = query.trim();

  useEffect(() => {
    if (!open || term.length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      let result;
      try {
        result = await searchAgenciesForAgentAction(term);
      } catch (err) {
        result = { ok: false, error: err.message, agencies: [] };
      }
      if (cancelled) return;
      setResults({ term, agencies: result?.agencies || [], error: result?.ok ? null : result?.error || t('errors.actionFailed') });
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, term, t]);

  function reset() {
    setQuery('');
    setResults({ term: '', agencies: [], error: null });
    setSelected(null);
    setLeftBehind(null);
    setSearching(false);
  }

  function confirm() {
    if (!selected) return;
    startTransition(async () => {
      let result;
      try {
        const formData = new FormData();
        formData.set('vendor_id', String(selected.id));
        result = await reassignAgentVendorAction(agentId, formData);
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
        return;
      }
      showToast({ type: 'success', message: t('admin.agentProfile.agency.moved', { name: selected.name }) });
      router.refresh();
      if (result.previousLeftEmpty && result.previousVendorId) {
        setLeftBehind({ id: result.previousVendorId, name: currentVendorName });
      } else {
        setOpen(false);
        reset();
      }
    });
  }

  const shown = term.length >= 2 && results.term === term ? results.agencies : [];

  return (
    <>
      <button type="button" className={BUTTON} onClick={() => { reset(); setOpen(true); }}>
        <Building2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        {t('admin.agents.changeAgency')}
      </button>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.agents.changeAgencyTitle')}</DialogTitle>
            <DialogDescription>
              {agentName}
              {' · '}
              {currentVendorId
                ? t('admin.agentProfile.agency.current', { name: currentVendorName || `#${currentVendorId}` })
                : t('admin.agentProfile.agency.none')}
            </DialogDescription>
          </DialogHeader>

          {leftBehind ? (
            <div className="u-micro space-y-2 rounded-lg border border-line bg-canvas-alt px-3 py-3 text-ink">
              <p>{t('admin.agentProfile.agency.moved', { name: selected?.name || '' })}</p>
              <p className="text-ink-70">{t('admin.agentProfile.agency.oldEmpty', { name: leftBehind.name || `#${leftBehind.id}` })}</p>
              <Link href={`/admin/agencies/${leftBehind.id}`} className="font-semibold text-blue-deep hover:underline">
                {t('admin.agentProfile.agency.openOld')}
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="u-micro-strong block text-ink" htmlFor="agent-agency-search">
                {t('admin.agentProfile.agency.searchLabel')}
              </label>
              <div className="relative">
                <Search strokeWidth={ICON_STROKE_WIDTH} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-45" />
                <input
                  id="agent-agency-search"
                  type="search"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSelected(null); }}
                  placeholder={t('admin.agentProfile.agency.searchPlaceholder')}
                  className="u-focus-ring u-micro h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2.5 text-ink"
                />
              </div>

              {term.length < 2 ? (
                <p className="u-micro text-ink-45">{t('admin.agentProfile.agency.searchHint')}</p>
              ) : searching && !shown.length ? (
                <p className="u-micro text-ink-45">{t('admin.agentProfile.agency.searching')}</p>
              ) : results.error && results.term === term ? (
                <p className="u-micro text-danger">{results.error}</p>
              ) : results.term === term && !shown.length ? (
                <p className="u-micro text-ink-45">{t('admin.agentProfile.agency.noResult')}</p>
              ) : (
                <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {shown.map((agency) => {
                    const isCurrent = agency.id === Number(currentVendorId);
                    const isSelected = selected?.id === agency.id;
                    return (
                      <li key={agency.id}>
                        <button
                          type="button"
                          disabled={isCurrent}
                          aria-pressed={isSelected}
                          onClick={() => setSelected(agency)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left disabled:cursor-default ${isSelected ? 'bg-blue/10' : 'hover:bg-canvas-alt'}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="u-micro-strong block truncate text-ink">
                              {agency.name}
                              <span className="font-normal text-ink-45"> · #{agency.id}</span>
                            </span>
                            <span className="u-micro block truncate text-ink-45">
                              {t('admin.agentProfile.agency.agents', { count: agency.agents })}
                              {agency.contactName ? ` · ${t('admin.agentProfile.agency.contact', { name: agency.contactName })}` : ''}
                              {isCurrent ? ` · ${t('admin.agentProfile.agency.isCurrent')}` : ''}
                            </span>
                          </span>
                          {isSelected ? <Check strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-blue-deep" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {selected ? (
                <p className="u-micro text-ink-70">{t('admin.agentProfile.agency.quotaNote')}</p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            {leftBehind ? (
              <button type="button" className={SMALL_BUTTON} onClick={() => { setOpen(false); reset(); }}>
                {t('common.actions.close')}
              </button>
            ) : (
              <>
                <button type="button" className={SMALL_BUTTON} onClick={() => { setOpen(false); reset(); }}>
                  {t('common.actions.cancel')}
                </button>
                <button type="button" disabled={!selected || pending} className={PRIMARY} onClick={confirm}>
                  {selected ? t('admin.agentProfile.agency.confirm', { name: selected.name }) : t('common.actions.save')}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
