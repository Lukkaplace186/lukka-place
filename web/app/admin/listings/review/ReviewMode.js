'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Expand, ImageOff, PencilLine, X } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import CommuneOptions from '@/components/CommuneOptions';
import QuartierPicker from '@/components/QuartierPicker';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH, PARCELLE_SUBTYPES } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { placeLabel } from '@/lib/placeLabel';
import { useT } from '@/lib/i18n/client';
import { QUICK_EDIT_FIELDS, applyQuickEdit, fixableBySkipReason, quickEditEntries, quickEditValues } from '@/lib/reviewQuickEdit';
import { AgentCell, ChecksCell, ageLabel } from '../ModerationCells';
import PhotoViewer from '../PhotoViewer';
import RejectReasons, { REVIEW_REASON_ORDER } from '../RejectReasons';
import { moderateListingsAction } from '../actions';
import { adminUpdateListingAction } from '../[id]/actions';

const KBD = 'u-tabular h-5 min-w-5 place-items-center rounded px-1 text-[0.6875rem] font-extrabold';
const FIELD = 'u-focus-ring h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] text-ink';
const LABEL = 'mb-1 block text-[0.75rem] text-ink-45';
const PERIODS = ['mois', 'an', 'jour', 'semaine', 'total'];
const SUBTYPE_LABEL_KEYS = Object.fromEntries(PARCELLE_SUBTYPES.map(({ value, labelKey }) => [value, labelKey]));

/** "10:04", Kinshasa time. */
function clock(iso) {
  return new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Africa/Kinshasa', hour: '2-digit', minute: '2-digit' });
}

function typing(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
}

/** The big photo, its arrows and thumbnails; keyed by listing so it opens on photo 1. */
function Gallery({ item, t, onFullScreen }) {
  const [index, setIndex] = useState(0);
  const touchX = useRef(null);
  const photos = item.photos || [];
  const count = photos.length;
  const go = (delta) => count && setIndex((current) => (current + delta + count) % count);
  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-[clamp(16rem,52vh,34rem)] overflow-hidden rounded-card bg-canvas-deep"
        onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => {
          if (touchX.current == null) return;
          const dx = event.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        {count ? (
          <SafeImage key={photos[index]} src={photos[index]} alt={t('admin.moderation.viewer.photoOf', { n: index + 1, total: count })} fill sizes="(min-width: 1024px) 60vw, 100vw" className="object-contain" priority />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-ink-45">
            <span className="inline-flex items-center gap-2"><ImageOff strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />{t('admin.moderation.viewer.noPhoto')}</span>
          </div>
        )}
        {count > 1 ? (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t('admin.moderation.viewer.previous')} className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-sm hover:bg-white">
              <ChevronLeft strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t('admin.moderation.viewer.next')} className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-sm hover:bg-white">
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
            </button>
          </>
        ) : null}
        {count ? (
          <>
            <span className="u-tabular absolute bottom-3 left-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-bold text-white">{index + 1} / {count}</span>
            <button type="button" onClick={() => onFullScreen(index)} className="absolute bottom-3 right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-bold text-ink hover:bg-white">
              <Expand strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
              {t('admin.moderation.review.fullScreen')}
            </button>
          </>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t('admin.moderation.viewer.photoOf', { n: i + 1, total: count })}
              aria-current={i === index ? 'true' : undefined}
              className={`relative h-16 w-[5.5rem] shrink-0 overflow-hidden rounded-lg ${i === index ? 'outline outline-2 outline-offset-2 outline-blue' : 'opacity-70 hover:opacity-100'}`}
            >
              <SafeImage src={src} alt="" fill sizes="88px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What the agent sent, as they sent it: the inbound WhatsApp messages around the draft. */
function AgentMessages({ item, t }) {
  const source = item.source;
  if (item.sourceUnavailable) return <p className="u-micro text-ink-45">{t('admin.moderation.review.sourceUnavailable')}</p>;
  if (!source || source.channel === 'web') {
    return (
      <div className="flex flex-col gap-2">
        <p className="u-micro text-ink-45">{t('admin.moderation.review.webCreated')}</p>
        {item.facts?.description ? (
          <p className="whitespace-pre-line rounded-xl bg-canvas-alt px-3 py-2.5 text-[0.8125rem] leading-5 text-ink">{item.facts.description}</p>
        ) : null}
      </div>
    );
  }
  const messages = source.messages || [];
  if (!messages.length) {
    return source.rawText ? (
      <p className="whitespace-pre-line rounded-xl bg-canvas-alt px-3 py-2.5 text-[0.8125rem] leading-5 text-ink">{source.rawText}</p>
    ) : (
      <p className="u-micro text-ink-45">{t('admin.moderation.review.noMessage')}</p>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {messages.map((message, i) => (
        <li key={`${message.at}-${i}`} className="rounded-xl bg-canvas-alt px-3 py-2.5 text-[0.8125rem] leading-5 text-ink">
          {message.body ? <p className="whitespace-pre-line break-words">{message.body}</p> : null}
          {message.mediaCount ? (
            <p className="text-ink-45">{t('admin.moderation.review.photosSent', { count: message.mediaCount })}</p>
          ) : !message.body ? (
            <p className="text-ink-45">{t('admin.moderation.review.attachment', { kind: message.kind })}</p>
          ) : null}
          <p className="u-tabular mt-1 text-[0.6875rem] text-ink-35">{clock(message.at)}</p>
        </li>
      ))}
    </ol>
  );
}

/** What we extracted, field by field; anything not stated says so. */
function WhatWeRead({ item, t, onEdit }) {
  const facts = item.facts || {};
  const subtype = facts.parcelleSubtype && SUBTYPE_LABEL_KEYS[facts.parcelleSubtype]
    ? t(SUBTYPE_LABEL_KEYS[facts.parcelleSubtype])
    : facts.parcelleSubtype;
  const notStated = <span className="font-normal text-ink-35">{t('admin.moderation.review.notStated')}</span>;
  const months = (value) => (value == null ? notStated : t('admin.moderation.review.months', { count: value }));
  const rows = [
    ['type', subtype || facts.categoryName],
    ['transaction', item.purpose === 'sale' ? t('admin.moderation.review.sale') : item.purpose === 'rent' ? t('admin.moderation.review.rent') : null],
    ['price', item.price ? formatPrice(item.price, item.purpose, item.pricePeriod) : null],
    ['place', placeLabel({ quartier: item.quartier, commune: item.commune })],
    ['reference', item.reference],
    ['beds', item.beds],
    ['baths', facts.bath],
    ['area', Number(facts.area) > 0 ? `${facts.area} m²` : null],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-ink-45">{t(`admin.moderation.review.field.${key}`)}</dt>
            <dd className="font-semibold text-ink">{value == null || value === '' ? notStated : value}</dd>
          </div>
        ))}
        {item.purpose !== 'sale' ? (
          <>
            <dt className="text-ink-45">{t('admin.moderation.review.field.deposit')}</dt>
            <dd className="font-semibold text-ink">{months(facts.depositMonths)}</dd>
            <dt className="text-ink-45">{t('admin.moderation.review.field.advance')}</dt>
            <dd className="font-semibold text-ink">{months(facts.advanceMonths)}</dd>
            <dt className="text-ink-45">{t('admin.moderation.review.field.commission')}</dt>
            <dd className="font-semibold text-ink">{months(facts.commissionMonths)}</dd>
          </>
        ) : null}
      </dl>
      {onEdit ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={onEdit} className="u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue px-3 text-blue hover:bg-blue-tint">
            <PencilLine strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            {t('admin.moderation.review.fixHere')}
            <span className={`${KBD} hidden border border-blue/40 lg:inline-grid`}>E</span>
          </button>
          <Link href={`/admin/listings/${item.id}`} className="u-micro text-ink-45 hover:text-blue hover:underline">
            {t('admin.moderation.review.quickEdit.allFields')}
          </Link>
        </div>
      ) : (
        <Link href={`/admin/listings/${item.id}`} className="u-micro-strong text-blue hover:text-blue-deep hover:underline">
          {t('admin.moderation.review.fixField')}
        </Link>
      )}
    </div>
  );
}

/**
 * "Ce que nous avons lu", editable in place: the fields a moderator corrects
 * most, still beside the agent's own message. Saves through the listing
 * page's adminUpdateListingAction (lib/reviewQuickEdit.js says what is sent).
 * While it is open the footer's green button is "Enregistrer et approuver";
 * Ctrl+Entrée does the same, Échap cancels.
 */
function QuickEdit({ item, editing, t, pending, apiRef, onCancel, onSubmit }) {
  const initial = useMemo(() => quickEditValues(item), [item]);
  const [commune, setCommune] = useState(initial.commune);
  const [currency, setCurrency] = useState(initial.currency);
  const [purpose, setPurpose] = useState(initial.purpose);
  const formRef = useRef(null);
  const firstRef = useRef(null);
  const { communes, locations, categories } = editing;

  function submit(approveAfter) {
    const form = formRef.current;
    if (!form || pending || !form.reportValidity()) return;
    const data = new FormData(form);
    const values = Object.fromEntries(QUICK_EDIT_FIELDS.map((name) => [name, data.has(name) ? String(data.get(name)) : initial[name]]));
    onSubmit({ initial, values, approveAfter });
  }

  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  // The footer's "Enregistrer et approuver" submits this form.
  useEffect(() => {
    apiRef.current = { submit };
    return () => { apiRef.current = null; };
  });

  const field = (key) => t(`admin.moderation.review.field.${key}`);
  const q = (key) => t(`admin.moderation.review.quickEdit.${key}`);
  const subtypeKnown = !initial.parcelle_subtype || SUBTYPE_LABEL_KEYS[initial.parcelle_subtype];

  return (
    <form
      ref={formRef}
      onSubmit={(event) => { event.preventDefault(); submit(false); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(true); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
      }}
      className="flex flex-col gap-2.5 text-[0.8125rem]"
    >
      <label>
        <span className={LABEL}>{q('title')}</span>
        <input ref={firstRef} name="title" defaultValue={initial.title} maxLength={150} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={LABEL}>{field('type')}</span>
          <select name="category_id" defaultValue={initial.category_id} className={FIELD}>
            <option value="">{q('none')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          <span className={LABEL}>{q('subtype')}</span>
          <select name="parcelle_subtype" defaultValue={initial.parcelle_subtype} className={FIELD}>
            <option value="">{q('none')}</option>
            {PARCELLE_SUBTYPES.map(({ value, labelKey }) => <option key={value} value={value}>{t(labelKey)}</option>)}
            {subtypeKnown ? null : <option value={initial.parcelle_subtype}>{initial.parcelle_subtype}</option>}
          </select>
        </label>
      </div>
      <label>
        <span className={LABEL}>{field('transaction')}</span>
        <select name="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} className={FIELD}>
          <option value="rent">{t('admin.moderation.review.rent')}</option>
          <option value="sale">{t('admin.moderation.review.sale')}</option>
        </select>
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
        <label>
          <span className={LABEL}>{currency === 'CDF' ? q('priceUsd') : field('price')}</span>
          <input name="price" type="number" min="0" step="any" inputMode="decimal" defaultValue={initial.price} className={`${FIELD} u-tabular`} />
        </label>
        <label>
          <span className={LABEL}>{q('currency')}</span>
          <select name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} className={FIELD}>
            <option value="USD">USD</option>
            <option value="CDF">FC</option>
          </select>
        </label>
      </div>
      {currency === 'CDF' ? (
        <label>
          <span className={LABEL}>{q('priceOriginal')}</span>
          <input name="price_original" type="number" min="0" step="any" inputMode="decimal" defaultValue={initial.price_original} className={`${FIELD} u-tabular`} />
        </label>
      ) : null}
      <label>
        <span className={LABEL}>{q('period')}</span>
        <select name="price_period" defaultValue={initial.price_period} className={FIELD}>
          <option value="">{q('periodNone')}</option>
          {PERIODS.map((period) => <option key={period} value={period}>{q(`periodOption.${period}`)}</option>)}
          {initial.price_period && !PERIODS.includes(initial.price_period) ? <option value={initial.price_period}>{initial.price_period}</option> : null}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={LABEL}>{q('commune')}</span>
          <select name="commune" value={commune} onChange={(event) => setCommune(event.target.value)} className={FIELD}>
            <option value="">{q('none')}</option>
            <CommuneOptions communes={communes} />
            {commune && !communes.includes(commune) ? <option value={commune}>{commune}</option> : null}
          </select>
        </label>
        <div>
          <span className={LABEL}>{q('quartier')}</span>
          <QuartierPicker commune={commune} locations={locations} defaultValue={initial.quartier} className={FIELD} />
        </div>
      </div>
      <label>
        <span className={LABEL}>{field('reference')}</span>
        <input name="reference" defaultValue={initial.reference} maxLength={60} className={FIELD} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label>
          <span className={LABEL}>{field('beds')}</span>
          <input name="beds" type="number" min="0" defaultValue={initial.beds} className={`${FIELD} u-tabular`} />
        </label>
        <label>
          <span className={LABEL}>{field('baths')}</span>
          <input name="bath" type="number" min="0" defaultValue={initial.bath} className={`${FIELD} u-tabular`} />
        </label>
        <label>
          <span className={LABEL}>{q('areaM2')}</span>
          <input name="area" type="number" min="0" step="any" defaultValue={initial.area} className={`${FIELD} u-tabular`} />
        </label>
      </div>
      {purpose !== 'sale' ? (
        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className={LABEL}>{field('deposit')}</span>
            <input name="deposit_months" type="number" min="0" defaultValue={initial.deposit_months} className={`${FIELD} u-tabular`} />
          </label>
          <label>
            <span className={LABEL}>{field('advance')}</span>
            <input name="advance_months" type="number" min="0" defaultValue={initial.advance_months} className={`${FIELD} u-tabular`} />
          </label>
          <label>
            <span className={LABEL}>{field('commission')}</span>
            <input name="commission_months" type="number" min="0" defaultValue={initial.commission_months} className={`${FIELD} u-tabular`} />
          </label>
        </div>
      ) : null}
      <label>
        <span className={LABEL}>{q('description')}</span>
        <textarea name="description" defaultValue={initial.description} rows={4} maxLength={4000} className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-2.5 text-[0.8125rem] leading-5 text-ink" />
      </label>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="submit" disabled={pending} className="u-press u-micro-strong inline-flex h-9 items-center rounded-lg bg-blue px-3.5 text-white hover:bg-blue-deep disabled:opacity-50">
          {q('save')}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="u-press u-micro-strong inline-flex h-9 items-center rounded-lg border border-line px-3 text-ink disabled:opacity-50">
          {q('cancel')}
        </button>
      </div>
      <p className="u-micro text-ink-45">{q('approveHint')}</p>
    </form>
  );
}

/**
 * The pending listings one at a time, full screen. A approves, R opens the
 * reasons (1–7 pick one, Entrée confirms), → skips, ← goes back, Échap
 * leaves. Each decision opens the next listing by itself.
 */
export default function ReviewMode({ items: initialItems, renderedAt, counts, only, editing = null }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState({}); // id → 'approved' | 'rejected' | 'skipped'
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [viewer, setViewer] = useState(false);
  // The queue as it opened. A Server Action's revalidation re-renders this
  // page with the listing just decided gone, which would shift every index
  // under the cursor; the review keeps its own order to the end.
  const [items] = useState(initialItems);
  const [done, setDone] = useState(items.length === 0);
  const [edits, setEdits] = useState({}); // id → saved quickEditValues
  const [editFor, setEditFor] = useState(null); // id whose editor is open
  const editApi = useRef(null);

  const base = items[index];
  const item = base && editing && edits[base.id] ? applyQuickEdit(base, edits[base.id], editing.categories) : base;
  const total = items.length;
  const tally = Object.values(decisions).reduce((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
  const decided = item ? decisions[item.id] : null;
  const final = decided === 'approved' || decided === 'rejected';
  const editOpen = Boolean(item && editing && editFor === item.id && !final);

  function exit() {
    router.push('/admin/listings');
    router.refresh();
  }

  /** The next listing nothing was decided on yet, after `from`; the end screen when none is left. */
  function advance(nextDecisions, from = index) {
    const next = items.findIndex((candidate, i) => i > from && !nextDecisions[candidate.id]);
    if (next === -1) setDone(true);
    else setIndex(next);
  }

  function record(id, value) {
    const next = { ...decisions, [id]: value };
    setDecisions(next);
    return next;
  }

  /** Runs inside a transition. A refusal the editor can fix opens the editor. */
  async function approveNow(id) {
    let result;
    try {
      result = await moderateListingsAction({ ids: [id], decision: 'approve' });
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (!result?.ok) {
      showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
      return;
    }
    if (result.skipped?.length) {
      const reason = result.skipped[0].reason;
      showToast({ type: 'error', message: reason });
      if (editing && fixableBySkipReason(reason)) setEditFor(id);
      return;
    }
    showToast({ type: 'success', message: t('admin.moderation.review.approvedToast', { id }) });
    setEditFor(null);
    advance(record(id, 'approved'));
  }

  function approve() {
    if (!item || pending || final) return;
    if (editOpen) {
      editApi.current?.submit(true);
      return;
    }
    startTransition(() => approveNow(item.id));
  }

  /** Save what changed in the editor, then approve when asked to. */
  function saveEdit({ initial, values, approveAfter }) {
    if (!item || !editing || pending) return;
    const id = item.id;
    const entries = quickEditEntries(initial, values, { listingStatus: item.facts?.listingStatus || '' });
    startTransition(async () => {
      if (entries.length) {
        const formData = new FormData();
        for (const [name, value] of entries) formData.append(name, value);
        let result;
        try {
          result = await adminUpdateListingAction(id, editing.communes, editing.categories.map((c) => c.id), formData);
        } catch (err) {
          result = { ok: false, error: err.message };
        }
        if (!result?.ok) {
          showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
          return;
        }
        setEdits((current) => ({ ...current, [id]: values }));
      }
      if (approveAfter) {
        await approveNow(id);
        return;
      }
      setEditFor(null);
      showToast(entries.length
        ? { type: 'success', message: t('admin.moderation.review.quickEdit.savedToast', { id }) }
        : { type: 'success', message: t('admin.moderation.review.quickEdit.noChange') });
    });
  }

  function reject() {
    if (!item || pending || final || !reasonCode) return;
    startTransition(async () => {
      let result;
      try {
        result = await moderateListingsAction({ ids: [item.id], decision: 'reject', reasonCode, note });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok || result.skipped?.length) {
        showToast({ type: 'error', message: result?.error || result?.skipped?.[0]?.reason || t('errors.actionFailed') });
        return;
      }
      showToast({ type: 'success', message: t('admin.moderation.review.rejectedToast', { id: item.id }) });
      setRejectOpen(false);
      setReasonCode('');
      setNote('');
      advance(record(item.id, 'rejected'));
    });
  }

  function skip() {
    if (!item || pending) return;
    advance(final ? decisions : record(item.id, 'skipped'));
  }

  function previous() {
    if (index > 0 && !pending) setIndex(index - 1);
  }

  function reviewSkipped() {
    const next = Object.fromEntries(Object.entries(decisions).filter(([, value]) => value !== 'skipped'));
    setDecisions(next);
    const first = items.findIndex((candidate) => !next[candidate.id]);
    setIndex(first === -1 ? 0 : first);
    setDone(first === -1);
  }

  // Keyboard: listening on the window is the point of a review mode. Ignored
  // while typing, with a modifier held, or while the full-screen photos are open.
  useEffect(() => {
    function onKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || viewer || done) return;
      if (rejectOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setRejectOpen(false); return; }
        if (event.key === 'Enter' && reasonCode) { event.preventDefault(); reject(); return; }
        if (typing(event.target)) return;
        const n = Number.parseInt(event.key, 10);
        if (n >= 1 && n <= REVIEW_REASON_ORDER.length) { event.preventDefault(); setReasonCode(REVIEW_REASON_ORDER[n - 1]); }
        return;
      }
      if (editOpen) {
        // The form handles its own keys; outside it, Échap closes it.
        if (event.key === 'Escape' && !typing(event.target)) { event.preventDefault(); setEditFor(null); }
        return;
      }
      if (typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'a') { event.preventDefault(); approve(); }
      else if (key === 'e' && editing && !final) { event.preventDefault(); setEditFor(item.id); }
      else if (key === 'r' && !final) { event.preventDefault(); setRejectOpen(true); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); skip(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
      else if (event.key === 'Escape') { event.preventDefault(); exit(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const segments = total > 0 && total <= 20;
  const progress = total ? Math.round(((index + (done ? 1 : 0)) / total) * 100) : 100;

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-canvas-alt text-ink-70" aria-busy={pending || undefined}>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <button type="button" onClick={exit} className="u-press u-micro-strong inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-ink hover:border-blue">
          <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">{t('admin.moderation.review.quit')}</span>
          <span className={`${KBD} hidden border border-line text-ink-45 lg:inline-grid`}>{t('admin.moderation.review.keyEscape')}</span>
        </button>
        <div className="flex items-baseline gap-2.5">
          <h1 className="u-title-section text-ink">{t('admin.moderation.review.heading')}</h1>
          {!done && total ? <span className="u-tabular font-extrabold text-ink">{t('admin.moderation.review.counter', { n: index + 1, total })}</span> : null}
        </div>
        {total ? (
          segments ? (
            <div aria-hidden="true" className="grid min-w-[8rem] max-w-sm flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
              {items.map((candidate, i) => {
                const state = decisions[candidate.id];
                const tone = state === 'approved' ? 'bg-success' : state === 'rejected' ? 'bg-danger' : i === index && !done ? 'bg-blue' : state === 'skipped' ? 'bg-ink-25' : 'bg-line';
                return <span key={candidate.id} className={`h-1.5 rounded-full ${tone}`} />;
              })}
            </div>
          ) : (
            <div aria-hidden="true" className="h-1.5 min-w-[8rem] max-w-sm flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-blue" style={{ width: `${progress}%` }} />
            </div>
          )
        ) : null}
        {!done && item ? (
          <button type="button" onClick={skip} disabled={pending} className="u-press u-micro-strong ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-blue sm:hidden">
            {t('admin.moderation.review.skip')}
            <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>
        ) : null}
        {!done && item ? (
          <p className="u-micro hidden text-ink-45 sm:ml-auto sm:block">
            {only === 'check'
              ? t('admin.moderation.review.onlyToCheck', { count: counts.check })
              : t('admin.moderation.review.order', { check: counts.check, ready: counts.ready })}
            {' · '}
            {t('admin.moderation.review.waiting')}{' '}
            <strong className={renderedAt - new Date(item.createdAt).getTime() > 24 * 3600 * 1000 ? 'text-danger' : 'text-ink'}>
              {ageLabel(Math.max(0, Math.round((renderedAt - new Date(item.createdAt).getTime()) / 60000)), t)}
            </strong>
          </p>
        ) : null}
      </header>

      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <h2 className="u-title-page text-ink">{total ? t('admin.moderation.review.doneTitle') : t('admin.moderation.review.emptyTitle')}</h2>
          {total ? (
            <p className="text-ink-70">
              {t('admin.moderation.review.doneSummary', { approved: tally.approved || 0, rejected: tally.rejected || 0, skipped: tally.skipped || 0 })}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            {tally.skipped ? (
              <button type="button" onClick={reviewSkipped} className="u-press inline-flex h-11 items-center rounded-lg border-[1.5px] border-blue px-4 font-bold text-blue hover:bg-blue-tint">
                {t('admin.moderation.review.reviewSkipped', { count: tally.skipped })}
              </button>
            ) : null}
            <button type="button" onClick={exit} className="u-press inline-flex h-11 items-center rounded-lg bg-blue px-5 font-bold text-white hover:bg-blue-deep">
              {t('admin.moderation.review.backToQueue')}
            </button>
          </div>
        </div>
      ) : item ? (
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-wrap items-start gap-5 p-4 sm:p-6">
              <section aria-label={t('admin.moderation.review.photos')} className="flex min-w-0 flex-[3_1_34rem] flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xl font-bold leading-7 text-ink">{item.title || t('admin.moderation.untitled')}</p>
                    <p className="u-micro text-ink-45">
                      {[placeLabel({ quartier: item.quartier, commune: item.commune }), item.reference ? `Réf. ${item.reference}` : null, `#${item.id}`].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="u-tabular text-xl font-extrabold tracking-tight text-ink">
                      {item.price ? formatPrice(item.price, item.purpose, item.pricePeriod) : t('admin.moderation.flag.missing_price')}
                    </div>
                    {item.outlier ? (
                      <div className="u-micro text-warning">
                        {t('admin.moderation.review.vsMedianLong', { ratio: item.outlier.ratio, commune: item.commune, sample: item.outlier.sample })}
                      </div>
                    ) : null}
                  </div>
                </div>
                {decided && final ? (
                  <p className={`u-micro-strong rounded-lg px-3 py-2 ${decided === 'approved' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`}>
                    {t(decided === 'approved' ? 'admin.moderation.review.alreadyApproved' : 'admin.moderation.review.alreadyRejected')}
                  </p>
                ) : null}
                <Gallery key={item.id} item={item} t={t} onFullScreen={() => setViewer(true)} />
              </section>

              {/* The editor needs room for its selects: the side column widens while it is open. */}
              <aside className={`flex min-w-0 flex-col gap-4 ${editOpen ? 'flex-[2_1_30rem]' : 'flex-[1_1_24rem]'}`}>
                <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-4">
                  <p className="u-eyebrow text-ink-45">{t('admin.moderation.colAgent')}</p>
                  <div className="u-micro"><AgentCell row={item} t={t} now={renderedAt} size="lg" /></div>
                </section>
                <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-4">
                  <p className="u-eyebrow text-ink-45">{t('admin.moderation.review.toLookAt')}</p>
                  <div className="u-micro"><ChecksCell row={item} t={t} /></div>
                </section>
                <section className={`u-card grid grid-cols-1 gap-4 rounded-card bg-surface p-4 ${editOpen ? 'sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'sm:grid-cols-2'}`}>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="u-eyebrow text-ink-45">{t('admin.moderation.review.agentMessage')}</p>
                    <AgentMessages item={item} t={t} />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="u-eyebrow text-ink-45">{t(editOpen ? 'admin.moderation.review.quickEdit.heading' : 'admin.moderation.review.whatWeRead')}</p>
                    {editOpen ? (
                      <QuickEdit
                        key={item.id}
                        item={item}
                        editing={editing}
                        t={t}
                        pending={pending}
                        apiRef={editApi}
                        onCancel={() => setEditFor(null)}
                        onSubmit={saveEdit}
                      />
                    ) : (
                      <WhatWeRead item={item} t={t} onEdit={editing && !final ? () => setEditFor(item.id) : null} />
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:px-6">
            <div className="hidden gap-2 sm:flex">
              <button type="button" onClick={previous} disabled={index === 0 || pending} className="u-press u-micro-strong inline-flex h-11 items-center gap-2 rounded-lg border border-line px-3 text-ink disabled:opacity-40">
                <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                <span className="hidden sm:inline">{t('admin.moderation.review.previous')}</span>
              </button>
              <button type="button" onClick={skip} disabled={pending} className="u-press u-micro-strong inline-flex h-11 items-center gap-2 rounded-lg border border-line px-3 text-ink disabled:opacity-40">
                {t('admin.moderation.review.skip')}
                <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              </button>
            </div>
            <p className="u-micro hidden text-ink-45 xl:block">{t('admin.moderation.review.afterDecision')}</p>
            <div className="flex flex-1 gap-2 sm:flex-none">
              <button
                type="button"
                onClick={() => setRejectOpen(true)}
                disabled={pending || final || editOpen}
                className="u-press inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-danger px-5 text-[0.9375rem] font-bold text-danger hover:bg-danger-tint disabled:opacity-40 sm:flex-none"
              >
                <X strokeWidth={2.25} className="h-4 w-4" />
                {t('admin.moderation.review.reject')}
                <span className={`${KBD} hidden border border-danger/40 lg:inline-grid`}>R</span>
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={pending || final}
                className="u-press inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-success px-6 text-[0.9375rem] font-bold text-white disabled:opacity-40 sm:flex-none"
              >
                <Check strokeWidth={2.5} className="h-4 w-4" />
                {t(editOpen ? 'admin.moderation.review.quickEdit.saveAndApprove' : 'admin.moderation.review.approve')}
                {editOpen ? (
                  <span className={`${KBD} hidden border border-white/50 lg:inline-grid`}>Ctrl ↵</span>
                ) : (
                  <span className={`${KBD} hidden border border-white/50 lg:inline-grid`}>A</span>
                )}
              </button>
            </div>
          </footer>

          {rejectOpen ? (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-3 sm:p-6" onClick={(event) => { if (event.target === event.currentTarget) setRejectOpen(false); }}>
              <section role="dialog" aria-modal="true" aria-labelledby="review-reject" className="flex w-full max-w-3xl flex-col gap-5 rounded-[1.25rem] bg-surface p-5 shadow-2xl sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 id="review-reject" className="text-xl font-bold text-ink">{t('admin.moderation.review.rejectTitle')}</h2>
                    <p className="u-micro text-ink-45">{t('admin.moderation.review.rejectHint', { id: item.id })}</p>
                  </div>
                  <button type="button" onClick={() => setRejectOpen(false)} aria-label={t('common.actions.cancel')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-canvas-deep text-ink">
                    <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  </button>
                </div>
                <RejectReasons value={reasonCode} onChange={setReasonCode} note={note} onNoteChange={setNote} noteId="review-reject-note" showNumbers />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setRejectOpen(false)} className="u-press u-micro-strong inline-flex h-11 items-center gap-2 rounded-lg border border-line px-4 text-ink">
                    {t('common.actions.cancel')}
                    <span className={`${KBD} hidden border border-line text-ink-45 lg:inline-grid`}>{t('admin.moderation.review.keyEscape')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={reject}
                    disabled={!reasonCode || pending}
                    className="u-press inline-flex h-12 items-center gap-2 rounded-xl bg-danger px-5 text-[0.9375rem] font-bold text-white disabled:opacity-40"
                  >
                    {t('admin.moderation.review.rejectAndNext')}
                    <span className={`${KBD} hidden border border-white/50 lg:inline-grid`}>{t('admin.moderation.review.keyEnter')}</span>
                  </button>
                </div>
              </section>
            </div>
          ) : null}

          <PhotoViewer key={item.id} row={item} open={viewer} onOpenChange={setViewer} />
        </>
      ) : null}
    </div>
  );
}
