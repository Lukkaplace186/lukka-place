'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { PROPERTY_KINDS } from '@/lib/marketObservationRules';
import { addObservationAction, readPastedPostAction } from './actions';

const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none';
const LABEL = 'u-micro-strong flex flex-col gap-1 text-ink-70';
const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center rounded-lg bg-blue px-3 text-white hover:bg-blue-deep disabled:opacity-50';
const BUTTON_SECONDARY = 'u-press u-micro-strong inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';

const EMPTY = {
  source: 'facebook', source_url: '', posted_at: '', purpose: 'rent', property_kind: '', beds: '', price: '',
  currency: 'USD', price_period: 'mois', furnished: '', commune: '', quartier: '', title: '',
};

/**
 * Hand entry of one advert a team member read on Facebook or Zwandako (their
 * terms forbid collecting them automatically). Paste the post → "Lire
 * l'annonce" fills the fields with the engine's own extractor → check every
 * field → save. The pasted text itself is never stored.
 */
export default function ObservationEntryForm({ communes, sources }) {
  const t = useT();
  const router = useRouter();
  const formRef = useRef(null);
  const [fields, setFields] = useState(EMPTY);
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState(null);
  const [pending, startTransition] = useTransition();

  const set = (name) => (event) => setFields((prev) => ({ ...prev, [name]: event.target.value }));

  const readPaste = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await readPastedPostAction(paste);
        if (!result.ok) { setMessage({ tone: 'error', text: result.error }); return; }
        setFields((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(result.fields).filter(([, v]) => v !== '')) }));
        setMessage({ tone: 'ok', text: t('admin.marketObservations.pasteRead') });
      } catch {
        setMessage({ tone: 'error', text: t('admin.marketObservations.errors.pasteFailed') });
      }
    });
  };

  const save = (event) => {
    event.preventDefault();
    setMessage(null);
    const data = new FormData(formRef.current);
    startTransition(async () => {
      try {
        const result = await addObservationAction(data);
        if (!result.ok) { setMessage({ tone: 'error', text: result.error }); return; }
        setMessage({ tone: 'ok', text: result.message });
        setFields((prev) => ({ ...EMPTY, source: prev.source }));
        setPaste('');
        router.refresh();
      } catch {
        setMessage({ tone: 'error', text: t('errors.actionFailed') });
      }
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-white p-4 sm:p-5">
      <label className={LABEL}>
        {t('admin.marketObservations.pasteLabel')}
        <textarea
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          rows={4}
          maxLength={5000}
          className="u-micro w-full rounded-lg border border-line bg-surface p-3 text-ink focus:border-blue focus:outline-none"
          placeholder={t('admin.marketObservations.pastePlaceholder')}
        />
      </label>
      <div>
        <button type="button" onClick={readPaste} disabled={pending || paste.trim().length < 15} className={BUTTON_SECONDARY}>
          {t('admin.marketObservations.pasteButton')}
        </button>
      </div>

      <form ref={formRef} onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={LABEL}>
          {t('admin.marketObservations.fieldSource')}
          <select name="source" value={fields.source} onChange={set('source')} className={INPUT}>
            {sources.map((s) => <option key={s.key} value={s.key}>{s.key === 'other' ? t('admin.marketObservations.sourceOther') : s.name}</option>)}
          </select>
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          {t('admin.marketObservations.fieldUrl')}
          <input name="source_url" type="url" value={fields.source_url} onChange={set('source_url')} className={INPUT} placeholder="https://" />
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldDate')}
          <input name="posted_at" type="date" value={fields.posted_at} onChange={set('posted_at')} className={INPUT} />
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldPurpose')}
          <select name="purpose" value={fields.purpose} onChange={set('purpose')} className={INPUT}>
            <option value="rent">{t('admin.marketObservations.rent')}</option>
            <option value="sale">{t('admin.marketObservations.sale')}</option>
          </select>
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldKind')}
          <select name="property_kind" value={fields.property_kind} onChange={set('property_kind')} className={INPUT} required>
            <option value="">—</option>
            {PROPERTY_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldBeds')}
          <input name="beds" type="number" min="0" max="30" value={fields.beds} onChange={set('beds')} className={INPUT} />
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldFurnished')}
          <select name="furnished" value={fields.furnished} onChange={set('furnished')} className={INPUT}>
            <option value="">{t('admin.marketObservations.notStated')}</option>
            <option value="no">{t('admin.marketObservations.unfurnished')}</option>
            <option value="yes">{t('admin.marketObservations.furnished')}</option>
          </select>
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldPrice')}
          <input name="price" inputMode="decimal" value={fields.price} onChange={set('price')} className={INPUT} required />
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldCurrency')}
          <select name="currency" value={fields.currency} onChange={set('currency')} className={INPUT}>
            <option value="USD">USD ($)</option>
            <option value="CDF">CDF (FC)</option>
          </select>
        </label>
        {fields.purpose === 'rent' ? (
          <label className={LABEL}>
            {t('admin.marketObservations.fieldPeriod')}
            <select name="price_period" value={fields.price_period} onChange={set('price_period')} className={INPUT}>
              <option value="mois">{t('admin.marketObservations.periodMonth')}</option>
              <option value="an">{t('admin.marketObservations.periodYear')}</option>
              <option value="jour">{t('admin.marketObservations.periodDay')}</option>
              <option value="semaine">{t('admin.marketObservations.periodWeek')}</option>
            </select>
          </label>
        ) : <input type="hidden" name="price_period" value="total" />}
        <label className={LABEL}>
          {t('admin.marketObservations.fieldCommune')}
          <select name="commune" value={fields.commune} onChange={set('commune')} className={INPUT} required>
            <option value="">—</option>
            {communes.map((commune) => <option key={commune} value={commune}>{commune}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          {t('admin.marketObservations.fieldQuartier')}
          <input name="quartier" value={fields.quartier} onChange={set('quartier')} maxLength={120} className={INPUT} />
        </label>
        <label className={`${LABEL} sm:col-span-2`}>
          {t('admin.marketObservations.fieldNote')}
          <input name="title" value={fields.title} onChange={set('title')} maxLength={200} className={INPUT} placeholder={t('admin.marketObservations.fieldNotePlaceholder')} />
        </label>
        <div className="flex items-end sm:col-span-2 lg:col-span-4">
          <button type="submit" disabled={pending} className={BUTTON}>{t('admin.marketObservations.saveButton')}</button>
        </div>
      </form>
      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`u-micro ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
