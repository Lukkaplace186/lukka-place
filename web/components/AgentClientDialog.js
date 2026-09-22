'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Search } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import PhoneField from './PhoneField';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { splitPhone } from '@/lib/phone';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { MAX_CLIENT_COMMUNES, BUDGET_TOLERANCE } from '@/lib/clientMatching';
import { saveAgentClientAction } from '@/app/compte/agent/clientActions';
import { useToast } from './Toast';
import { useLocale, useT } from '@/lib/i18n/client';

const BEDROOM_OPTIONS = [1, 2, 3, 4, 5, 6];
const FIELD = 'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';
const LABEL = 'u-micro-strong mb-1.5 block text-ink-70';

/**
 * Add or edit one client in the agent's private book. Communes are picked
 * from the real list the rest of web uses (GET /locations via
 * getLocationHierarchyWithFallback) — never typed — and the server re-checks
 * them against its own copy. The phone goes through PhoneField, so the
 * country is data (web/CLAUDE.md, "Phone numbers are international now").
 */
export default function AgentClientDialog({ communes, client = null }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState(() => client?.communes || []);
  const [filter, setFilter] = useState('');
  const phoneParts = useMemo(() => splitPhone(client?.phone || ''), [client?.phone]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? communes.filter((c) => c.toLowerCase().includes(needle)) : communes;
  }, [communes, filter]);

  function toggleCommune(name) {
    setPicked((prev) => {
      if (prev.includes(name)) return prev.filter((c) => c !== name);
      if (prev.length >= MAX_CLIENT_COMMUNES) return prev;
      return [...prev, name];
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.delete('communes');
    for (const c of picked) formData.append('communes', c);
    startTransition(async () => {
      let result;
      try {
        result = await saveAgentClientAction(client?.id || null, formData);
      } catch (err) {
        console.error('[AgentClientDialog] save failed', err);
        showToast({ type: 'error', message: t('errors.submissionFailed') });
        return;
      }
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: client ? t('agent.clients.updated') : t('agent.clients.added') });
      setOpen(false);
      if (!client) setPicked([]);
      router.refresh();
    });
  }

  return (
    <>
      {client ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
        >
          <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.clients.edit')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="u-btn-primary u-press inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-3 text-[0.8125rem] font-bold text-white sm:h-11 sm:px-5 sm:text-sm"
        >
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.clients.add')}
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{client ? t('agent.clients.editTitle') : t('agent.clients.addTitle')}</DialogTitle>
            <DialogDescription>{t('agent.clients.privacyNote')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor={`client-name-${client?.id || 'new'}`} className={LABEL}>{t('agent.clients.fields.name')}</label>
              <input
                id={`client-name-${client?.id || 'new'}`}
                name="name"
                required
                maxLength={120}
                defaultValue={client?.name || ''}
                className={FIELD}
              />
            </div>

            <PhoneField
              name="phone"
              id={`client-phone-${client?.id || 'new'}`}
              locale={locale}
              required
              labels={{ ...phoneFieldLabels(t), label: t('agent.clients.fields.phone') }}
              {...(phoneParts.country
                ? { defaultCountry: phoneParts.country, defaultValue: phoneParts.national, detectCountry: false }
                : {})}
            />

            <fieldset>
              <legend className={LABEL}>{t('agent.clients.fields.purpose')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {['location', 'vente'].map((value) => (
                  <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm text-ink has-[:checked]:border-blue has-[:checked]:bg-blue-tint">
                    <input
                      type="radio"
                      name="transaction_type"
                      value={value}
                      required
                      defaultChecked={(client?.transaction_type || 'location') === value}
                      className="accent-[var(--blue)]"
                    />
                    {t(`agent.clients.purpose.${value}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className={LABEL}>
                {t('agent.clients.fields.communes', { max: MAX_CLIENT_COMMUNES })}
              </legend>
              {picked.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {picked.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleCommune(name)}
                      className="u-press inline-flex min-h-8 items-center gap-1 rounded-full bg-blue px-2.5 text-xs font-bold text-white"
                      aria-label={t('agent.clients.removeCommune', { name })}
                    >
                      {name} ×
                    </button>
                  ))}
                </div>
              )}
              {communes.length === 0 ? (
                <p className="u-micro text-ink-45">{t('agent.clients.communesUnavailable')}</p>
              ) : (
                <>
                  <div className="relative mb-2">
                    <Search strokeWidth={ICON_STROKE_WIDTH} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-35" />
                    <input
                      type="search"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder={t('agent.clients.searchCommune')}
                      aria-label={t('agent.clients.searchCommune')}
                      className={`${FIELD} pl-9`}
                    />
                  </div>
                  <div className="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-line p-1.5">
                    {visible.map((name) => (
                      <label key={name} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-[0.8125rem] text-ink hover:bg-canvas-alt">
                        <input
                          type="checkbox"
                          checked={picked.includes(name)}
                          disabled={!picked.includes(name) && picked.length >= MAX_CLIENT_COMMUNES}
                          onChange={() => toggleCommune(name)}
                          className="h-4 w-4 accent-[var(--blue)]"
                        />
                        <span className="truncate">{name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="u-micro mt-1 text-ink-35">{t('agent.clients.communesHint')}</p>
                </>
              )}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`client-min-${client?.id || 'new'}`} className={LABEL}>{t('agent.clients.fields.budgetMin')}</label>
                <input
                  id={`client-min-${client?.id || 'new'}`}
                  name="budget_min"
                  inputMode="decimal"
                  defaultValue={client?.budget_min ?? ''}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor={`client-max-${client?.id || 'new'}`} className={LABEL}>{t('agent.clients.fields.budgetMax')}</label>
                <input
                  id={`client-max-${client?.id || 'new'}`}
                  name="budget_max"
                  inputMode="decimal"
                  defaultValue={client?.budget_max ?? ''}
                  className={FIELD}
                />
              </div>
              <p className="u-micro col-span-2 -mt-1 text-ink-35">
                {t('agent.clients.budgetHint', { pct: Math.round(BUDGET_TOLERANCE * 100) })}
              </p>
            </div>

            <div>
              <label htmlFor={`client-beds-${client?.id || 'new'}`} className={LABEL}>{t('agent.clients.fields.bedrooms')}</label>
              <select
                id={`client-beds-${client?.id || 'new'}`}
                name="bedrooms"
                defaultValue={client?.bedrooms ? String(client.bedrooms) : ''}
                className={FIELD}
              >
                <option value="">{t('agent.clients.anyBedrooms')}</option>
                {BEDROOM_OPTIONS.map((n) => (
                  <option key={n} value={n}>{t('agent.clients.bedroomsAtLeast', { count: n })}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`client-notes-${client?.id || 'new'}`} className={LABEL}>{t('agent.clients.fields.notes')}</label>
              <textarea
                id={`client-notes-${client?.id || 'new'}`}
                name="notes"
                rows={3}
                maxLength={2000}
                defaultValue={client?.notes || ''}
                className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm text-ink"
              />
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <button
                  type="button"
                  className="u-press inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
                >
                  {t('common.actions.cancel')}
                </button>
              </DialogClose>
              <button
                type="submit"
                disabled={pending}
                className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
              >
                {pending ? t('agent.clients.saving') : t('agent.clients.save')}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
