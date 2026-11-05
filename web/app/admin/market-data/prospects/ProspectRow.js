'use client';

import { useState, useTransition } from 'react';
import { useT } from '@/lib/i18n/client';
import { PROSPECT_CHANNELS, PROSPECT_STATUSES, formatProspectPhone } from '@/lib/marketProspectRules';
import { updateProspectAction } from './actions';

const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-ink focus:border-blue focus:outline-none';
const LABEL = 'u-micro-strong flex min-w-0 flex-col gap-1 text-ink-70';

/** Recruiting opener, French whatever the console language: the agent reads it. */
function opener(name) {
  const hello = name ? `Bonjour ${name.split(' ')[0]}` : 'Bonjour';
  return `${hello}, je vous contacte de la part de Lukka Place (lukkaplace.com), le site d'annonces immobilières de Kinshasa. `
    + "J'ai vu vos annonces et j'aimerais vous présenter comment publier vos biens chez nous. Avez-vous un moment ?";
}

const STATUS_TONE = {
  todo: 'bg-blue-tint text-blue-deep',
  noanswer: 'bg-canvas-alt text-ink-70',
  callback: 'bg-warning-tint text-warning-ink',
  interested: 'bg-success-tint text-success',
  signed: 'bg-success text-white',
  declined: 'bg-canvas-alt text-ink-45',
  optout: 'bg-danger-tint text-danger',
};

/**
 * One prospect: who, where they were seen, the adverts behind them, and the
 * team's follow-up, saved in place. `canManage` false shows it read-only.
 */
export default function ProspectRow({ prospect, adverts, sourceNames, canManage }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    status: prospect.status,
    contacted_on: prospect.contacted_on_text || '',
    channel: prospect.channel || '',
    notes: prospect.notes || '',
    name: prospect.name || '',
    agency: prospect.agency || '',
  });
  const [message, setMessage] = useState(null);
  const [pending, startTransition] = useTransition();
  const set = (name) => (event) => setValues((prev) => ({ ...prev, [name]: event.target.value }));

  const save = (next = values) => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await updateProspectAction(prospect.id, next);
        setMessage(result.ok ? { tone: 'ok', text: t('admin.marketProspects.saved') } : { tone: 'error', text: result.error });
      } catch {
        setMessage({ tone: 'error', text: t('errors.actionFailed') });
      }
    });
  };

  // Marking a first contact also dates it (today, Kinshasa) when no date is set.
  const quickStatus = (status) => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa' }).format(new Date());
    const next = { ...values, status, contacted_on: values.contacted_on || (status !== 'todo' ? today : '') };
    setValues(next);
    save(next);
  };

  const wa = `https://wa.me/${prospect.phone}?text=${encodeURIComponent(opener(values.name))}`;

  return (
    <li className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="u-micro-strong text-ink">
            {values.name || <span className="text-ink-45">{t('admin.marketProspects.noName')}</span>}
            {values.agency ? <span className="font-normal text-ink-70"> · {values.agency}</span> : null}
            {prospect.is_agent ? <span className="ml-2 rounded-full bg-success-tint px-2 py-0.5 text-[0.6875rem] font-semibold text-success">{t('admin.marketProspects.alreadyAgent')}</span> : null}
          </p>
          <p className="u-micro mt-0.5 text-ink-45">
            <a href={`tel:+${prospect.phone}`} className="u-tabular font-semibold text-ink hover:underline">{formatProspectPhone(prospect.phone)}</a>
            {' · '}{(prospect.sources || []).map((s) => sourceNames[s] || s).join(', ') || '—'}
            {' · '}{t('admin.marketProspects.adverts', { count: prospect.adverts_count })}
            {adverts?.length ? (
              <button type="button" onClick={() => setOpen((v) => !v)} className="ml-1 text-blue-deep hover:underline">
                {open ? t('admin.marketProspects.hideAdverts') : t('admin.marketProspects.showAdverts')}
              </button>
            ) : null}
          </p>
        </div>
        <span className={`u-micro-strong rounded-full px-2.5 py-1 ${STATUS_TONE[values.status] || ''}`}>{t(`admin.marketProspects.status.${values.status}`)}</span>
        <a href={wa} target="_blank" rel="noopener noreferrer" className="u-press u-micro-strong inline-flex h-9 items-center rounded-lg bg-success px-3 text-white hover:opacity-90">
          {t('admin.marketProspects.whatsapp')}
        </a>
      </div>

      {open && adverts?.length ? (
        <ul className="u-micro mt-2 flex flex-col gap-0.5 rounded-lg bg-canvas p-2.5 text-ink-70">
          {adverts.map((a) => (
            <li key={a.id}>
              {[a.purpose === 'sale' ? t('admin.marketObservations.sale') : t('admin.marketObservations.rent'), a.property_kind, a.beds !== null ? t('admin.marketObservations.beds', { n: a.beds }) : null, [a.quartier, a.commune].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
              {' — '}
              <span className="u-tabular font-semibold text-ink">{a.monthly_usd ? `${Number(a.monthly_usd).toLocaleString('fr-FR')} $ / mois` : a.price_usd ? `${Number(a.price_usd).toLocaleString('fr-FR')} $` : '—'}</span>
              {a.excluded_reason ? <span className="text-ink-35"> ({t('admin.marketProspects.advertExcluded')})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {['noanswer', 'callback', 'interested', 'signed', 'declined'].map((status) => (
              <button
                key={status}
                type="button"
                disabled={pending || values.status === status}
                onClick={() => quickStatus(status)}
                className="u-press u-micro rounded-full border border-line px-3 py-1 text-ink hover:border-blue disabled:opacity-40"
              >
                {t(`admin.marketProspects.status.${status}`)}
              </button>
            ))}
          </div>
          <details className="mt-2">
            <summary className="u-micro-strong cursor-pointer text-ink-70 hover:text-ink">{t('admin.marketProspects.edit')}</summary>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              <label className={LABEL}>
                {t('admin.marketPaste.contactName')}
                <input value={values.name} onChange={set('name')} maxLength={120} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t('admin.marketPaste.agency')}
                <input value={values.agency} onChange={set('agency')} maxLength={120} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t('admin.marketProspects.fieldStatus')}
                <select value={values.status} onChange={set('status')} className={INPUT}>
                  {PROSPECT_STATUSES.map((s) => <option key={s} value={s}>{t(`admin.marketProspects.status.${s}`)}</option>)}
                </select>
              </label>
              <label className={LABEL}>
                {t('admin.marketProspects.fieldContactedOn')}
                <input type="date" value={values.contacted_on} onChange={set('contacted_on')} className={INPUT} />
              </label>
              <label className={LABEL}>
                {t('admin.marketProspects.fieldChannel')}
                <select value={values.channel} onChange={set('channel')} className={INPUT}>
                  <option value="">—</option>
                  {PROSPECT_CHANNELS.map((c) => <option key={c} value={c}>{t(`admin.marketProspects.channel.${c}`)}</option>)}
                </select>
              </label>
              <label className={`${LABEL} sm:col-span-2 lg:col-span-5`}>
                {t('admin.marketProspects.fieldNotes')}
                <textarea value={values.notes} onChange={set('notes')} maxLength={2000} rows={2} className="u-micro w-full rounded-lg border border-line bg-surface p-2.5 text-ink focus:border-blue focus:outline-none" />
              </label>
            </div>
            <button type="button" onClick={() => save()} disabled={pending} className="u-press u-micro-strong mt-2 inline-flex h-9 items-center rounded-lg bg-blue px-3 text-white hover:bg-blue-deep disabled:opacity-50">
              {t('admin.marketProspects.saveButton')}
            </button>
          </details>
        </>
      ) : values.notes ? <p className="u-micro mt-2 whitespace-pre-line text-ink-70">{values.notes}</p> : null}

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`u-micro mt-1.5 ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}>{message.text}</p>
      ) : null}
    </li>
  );
}
