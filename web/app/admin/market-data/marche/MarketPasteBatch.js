'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/client';
import { PROPERTY_KINDS } from '@/lib/marketObservationRules';
import { MAX_RAW_PASTE_CHARS, formatProspectPhone } from '@/lib/marketProspectRules';
import { readMarketPasteAction, saveMarketPasteAction } from './actions';

const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-ink focus:border-blue focus:outline-none';
const LABEL = 'u-micro-strong flex min-w-0 flex-col gap-1 text-ink-70';
const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center rounded-lg bg-blue px-3 text-white hover:bg-blue-deep disabled:opacity-50';
const BUTTON_SECONDARY = 'u-press u-micro-strong inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';

/**
 * "Coller des annonces" — one paste feeds the price guide AND the prospects
 * list (lib/marketProspectRules.js). Paste a page of adverts → "Lire" → one
 * card per advert with its price facts and its poster → check → one save.
 * Each card says what goes where: "Prix → guide" and "Agent → prospects" can
 * be switched off one by one. The pasted text is never stored.
 */
export default function MarketPasteBatch({ communes, sources }) {
  const t = useT();
  const router = useRouter();
  const [paste, setPaste] = useState('');
  const [source, setSource] = useState('facebook');
  const [sourceUrl, setSourceUrl] = useState('');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState(null);
  const [pending, startTransition] = useTransition();

  const update = (key, name, value) => setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [name]: value } : row)));
  const field = (key, name) => (event) => update(key, name, event.target.type === 'checkbox' ? event.target.checked : event.target.value);

  const read = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await readMarketPasteAction(paste);
        if (!result.ok) { setMessage({ tone: 'error', text: result.error }); return; }
        setRows(result.rows);
        setMessage({ tone: 'ok', text: t('admin.marketPaste.readDone', { count: result.rows.length }) });
      } catch {
        setMessage({ tone: 'error', text: t('admin.marketObservations.errors.pasteFailed') });
      }
    });
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await saveMarketPasteAction({ source, sourceUrl, rows });
        if (!result.ok) { setMessage({ tone: 'error', text: result.error }); return; }
        setMessage({ tone: 'ok', text: result.message });
        setRows([]);
        setPaste('');
        setSourceUrl('');
        router.refresh();
      } catch {
        setMessage({ tone: 'error', text: t('errors.actionFailed') });
      }
    });
  };

  const kept = rows.filter((row) => row.keepPrice || row.keepProspect).length;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-white p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <label className={LABEL}>
          {t('admin.marketObservations.fieldSource')}
          <select value={source} onChange={(event) => setSource(event.target.value)} className={INPUT}>
            {sources.map((s) => <option key={s.key} value={s.key}>{s.key === 'other' ? t('admin.marketObservations.sourceOther') : s.name}</option>)}
          </select>
        </label>
        <label className={LABEL}>
          {t('admin.marketPaste.pageUrl')}
          <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className={INPUT} placeholder="https://" />
        </label>
      </div>
      <label className={LABEL}>
        {t('admin.marketPaste.pasteLabel')}
        <textarea
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          rows={7}
          maxLength={MAX_RAW_PASTE_CHARS}
          className="u-micro w-full rounded-lg border border-line bg-surface p-3 text-ink focus:border-blue focus:outline-none"
          placeholder={t('admin.marketPaste.pastePlaceholder')}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={read} disabled={pending || paste.trim().length < 15} className={BUTTON_SECONDARY}>
          {pending && !rows.length ? t('admin.marketPaste.reading') : t('admin.marketPaste.readButton')}
        </button>
        <span className="u-micro text-ink-45">{t('admin.marketPaste.readHint')}</span>
      </div>

      {rows.length ? (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li key={row.key} className={`rounded-xl border p-3 sm:p-4 ${row.keepPrice || row.keepProspect ? 'border-line bg-canvas' : 'border-dashed border-line bg-surface opacity-60'}`}>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="u-micro-strong min-w-0 flex-1 text-ink">
                  {index + 1}. {row.title || t('admin.marketPaste.untitled')}
                  {row.postedHint ? <span className="font-normal text-ink-45"> · {row.postedHint}</span> : null}
                </p>
                <label className="u-micro inline-flex items-center gap-1.5 text-ink">
                  <input type="checkbox" checked={row.keepPrice} onChange={field(row.key, 'keepPrice')} />
                  {t('admin.marketPaste.keepPrice')}
                </label>
                <label className="u-micro inline-flex items-center gap-1.5 text-ink">
                  <input type="checkbox" checked={row.keepProspect} onChange={field(row.key, 'keepProspect')} />
                  {t('admin.marketPaste.keepProspect')}
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.2fr)_minmax(0,1.2fr)]">
                <label className={LABEL}>
                  {t('admin.marketObservations.fieldPurpose')}
                  <select value={row.purpose} onChange={(event) => { update(row.key, 'purpose', event.target.value); update(row.key, 'price_period', event.target.value === 'sale' ? 'total' : 'mois'); }} className={INPUT}>
                    <option value="rent">{t('admin.marketObservations.rent')}</option>
                    <option value="sale">{t('admin.marketObservations.sale')}</option>
                  </select>
                </label>
                <label className={LABEL}>
                  {t('admin.marketObservations.fieldKind')}
                  <select value={row.property_kind} onChange={field(row.key, 'property_kind')} className={INPUT}>
                    <option value="">—</option>
                    {PROPERTY_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                </label>
                <label className={LABEL}>
                  {t('admin.marketObservations.fieldBeds')}
                  <input type="number" min="0" max="30" value={row.beds} onChange={field(row.key, 'beds')} className={INPUT} />
                </label>
                <label className={LABEL}>
                  {row.purpose === 'sale' ? t('admin.marketPaste.priceSale') : t('admin.marketPaste.priceRent')}
                  <div className="flex gap-1">
                    <input inputMode="decimal" value={row.price} onChange={field(row.key, 'price')} className={INPUT} />
                    {row.purpose === 'rent' ? (
                      <select value={row.price_period} onChange={field(row.key, 'price_period')} className={`${INPUT} w-[5.5rem] shrink-0`} aria-label={t('admin.marketObservations.fieldPeriod')}>
                        <option value="mois">{t('admin.marketObservations.periodMonth')}</option>
                        <option value="an">{t('admin.marketObservations.periodYear')}</option>
                        <option value="jour">{t('admin.marketObservations.periodDay')}</option>
                        <option value="semaine">{t('admin.marketObservations.periodWeek')}</option>
                      </select>
                    ) : null}
                  </div>
                </label>
                <label className={LABEL}>
                  {t('admin.marketObservations.fieldCommune')}
                  <select value={row.commune} onChange={field(row.key, 'commune')} className={INPUT}>
                    <option value="">—</option>
                    {communes.map((commune) => <option key={commune} value={commune}>{commune}</option>)}
                  </select>
                </label>
                <label className={LABEL}>
                  {t('admin.marketObservations.fieldQuartier')}
                  <input value={row.quartier} onChange={field(row.key, 'quartier')} maxLength={120} className={INPUT} />
                </label>
              </div>

              {row.priceUnverified || row.communeWritten || row.communeFromQuartier || row.currency === 'CDF' ? (
                <ul className="u-micro mt-2 flex flex-col gap-0.5 text-warning-ink">
                  {row.priceUnverified ? <li>{t('admin.marketPaste.warnPrice')}</li> : null}
                  {row.currency === 'CDF' ? <li>{t('admin.marketPaste.warnFrancs')}</li> : null}
                  {row.communeWritten ? <li>{t('admin.marketPaste.warnCommune', { written: row.communeWritten })}</li> : null}
                  {row.communeFromQuartier ? <li className="text-ink-45">{t('admin.marketPaste.noteCommuneDeduced', { quartier: row.quartier })}</li> : null}
                </ul>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-line pt-3 sm:grid-cols-3">
                <label className={LABEL}>
                  {t('admin.marketPaste.contactName')}
                  <input value={row.name} onChange={field(row.key, 'name')} maxLength={120} className={INPUT} />
                </label>
                <label className={LABEL}>
                  {t('admin.marketPaste.agency')}
                  <input value={row.agency} onChange={field(row.key, 'agency')} maxLength={120} className={INPUT} />
                </label>
                <label className={LABEL}>
                  {t('admin.marketPaste.phone')}
                  <input inputMode="tel" value={row.phone} onChange={field(row.key, 'phone')} className={INPUT} placeholder="243…" />
                </label>
              </div>
              <p className="u-micro mt-1.5 text-ink-45">
                {!row.phone ? t('admin.marketPaste.noPhone')
                  : row.known?.isAgent ? <span className="font-semibold text-success">{t('admin.marketPaste.alreadyAgent', { phone: formatProspectPhone(row.phone) })}</span>
                    : row.known?.prospectId ? t('admin.marketPaste.alreadyProspect', { phone: formatProspectPhone(row.phone), status: t(`admin.marketProspects.status.${row.known.status}`) })
                      : t('admin.marketPaste.newProspect', { phone: formatProspectPhone(row.phone) })}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {rows.length ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={pending || kept === 0} className={BUTTON}>
            {t('admin.marketPaste.saveButton', { count: kept })}
          </button>
          <button type="button" onClick={() => { setRows([]); setMessage(null); }} disabled={pending} className={BUTTON_SECONDARY}>
            {t('admin.marketPaste.clear')}
          </button>
        </div>
      ) : null}

      {message ? (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`u-micro ${message.tone === 'error' ? 'text-danger' : 'text-success'}`}>{message.text}</p>
      ) : null}
    </div>
  );
}
