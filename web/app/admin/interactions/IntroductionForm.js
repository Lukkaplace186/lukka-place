'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Handshake } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { INTRODUCTION_CHANNELS } from '@/lib/interactionCounts';
import PhoneField from '@/components/PhoneField';
import AgentPicker from '../AgentPicker';
import { recordIntroductionAction } from './actions';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

/**
 * "Enregistrer une mise en relation": the one way an interaction that never
 * touched our systems (the desk phones an agent, the agent WhatsApps the
 * customer from his own phone) is counted. recordIntroductionAction
 * re-validates everything.
 */
export default function IntroductionForm() {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  const [formKey, setFormKey] = useState(0);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      let response;
      try {
        response = await recordIntroductionAction(formData);
      } catch (err) {
        response = { ok: false, error: err.message };
      }
      if (!response?.ok) {
        setError(response?.error || t('errors.actionFailed'));
        return;
      }
      setSaved(response.leadId);
      setFormKey((k) => k + 1);
    });
  }

  return (
    <form key={formKey} onSubmit={handleSubmit} className="u-card flex flex-col gap-4 rounded-card bg-surface p-5">
      <div>
        <h2 className="u-title-card text-ink">{t('admin.interactions.form.title')}</h2>
        <p className="u-micro mt-0.5 text-ink-45">{t('admin.interactions.form.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PhoneField
          name="phone"
          required
          autoComplete="off"
          // The desk is in Kinshasa: start on +243 whatever the browser's
          // language says (a diaspora customer's country is still pickable).
          detectCountry={false}
          labels={{ label: t('admin.interactions.form.customerPhone') }}
        />
        <label>
          <span className={LABEL}>{t('admin.interactions.form.customerName')}</span>
          <input name="name" maxLength={120} className={FIELD} />
        </label>
        <div>
          <span className={LABEL}>{t('admin.interactions.form.agent')}</span>
          <AgentPicker name="agent_id" activeOnly placeholder={t('admin.interactions.form.agentPlaceholder')} />
        </div>
        <label>
          <span className={LABEL}>{t('admin.interactions.form.listing')}</span>
          <input name="property_id" inputMode="numeric" placeholder="310" maxLength={13} className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.interactions.form.channel')}</span>
          <select name="channel" defaultValue="phone" className={FIELD}>
            {INTRODUCTION_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>{t(`admin.interactions.channel.${channel}`)}</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className={LABEL}>{t('admin.interactions.form.note')}</span>
          <textarea name="note" rows={2} maxLength={1000} className={`${FIELD} h-auto py-2`} placeholder={t('admin.interactions.form.notePlaceholder')} />
        </label>
      </div>

      <label className="u-micro flex items-start gap-2 text-ink-70">
        <input type="checkbox" name="agent_contacted" className="mt-0.5 h-4 w-4 rounded-sm accent-[var(--blue)]" />
        <span>{t('admin.interactions.form.agentContacted')}</span>
      </label>

      {error ? <p role="alert" className="u-micro rounded-lg bg-danger-tint px-3.5 py-2.5 text-danger">{error}</p> : null}
      {saved ? (
        <p role="status" className="u-micro rounded-lg bg-success-tint px-3.5 py-2.5 text-success">
          {t('admin.interactions.form.saved')}{' '}
          <Link href={`/admin/leads/${saved}`} className="font-bold underline">{t('admin.interactions.form.openLead', { id: saved })}</Link>
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="u-btn-primary u-press inline-flex h-10 items-center gap-2 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
        >
          <Handshake strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? t('admin.interactions.form.saving') : t('admin.interactions.form.submit')}
        </button>
      </div>
    </form>
  );
}
