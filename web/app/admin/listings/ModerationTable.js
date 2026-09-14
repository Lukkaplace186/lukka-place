'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BadgeCheck, CheckCircle2, ImageOff, Pencil, XCircle } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { QUALITY_FLAG_LABEL_KEYS, REJECTION_REASON_CODES, REJECTION_REASON_LABEL_KEYS } from '@/lib/moderation';
import { useT } from '@/lib/i18n/client';
import { Chip } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import { moderateListingsAction } from './actions';

const BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink transition-colors hover:border-blue disabled:opacity-50';

const DAY_MS = 24 * 3600 * 1000;

/** Waiting time measured against the server's render time, so server and browser print the same text. */
function waiting(iso, t, now) {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t('admin.moderation.waitMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('admin.moderation.waitHours', { count: hours });
  return t('admin.moderation.waitDays', { count: Math.round(hours / 24) });
}

/**
 * One page of the approval queue with row selection and the two decisions.
 * Approving many runs the publishability check per listing and reports the
 * ones it skipped; rejecting many asks for one reason that every selected
 * agent is told.
 */
export default function ModerationTable({ rows, status, canModerate, footer, renderedAt }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(null); // array of ids
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const decidable = status === 'pending' || status === 'rejected';

  function decide(ids, decision, reason = {}) {
    startTransition(async () => {
      let result;
      try {
        result = await moderateListingsAction({ ids, decision, ...reason });
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.actionFailed') });
        return;
      }
      const done = decision === 'approve' ? result.approved.length : result.rejected.length;
      showToast({
        type: result.skipped.length ? 'error' : 'success',
        message: [
          decision === 'approve' ? t('admin.moderation.approvedCount', { count: done }) : t('admin.moderation.rejectedCount', { count: done }),
          result.skipped.length ? t('admin.moderation.skippedCount', { count: result.skipped.length, first: result.skipped[0].reason }) : null,
        ].filter(Boolean).join(' '),
      });
      setSelected(new Set());
      setRejecting(null);
      setReasonCode('');
      setNote('');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {canModerate && decidable && selected.size > 0 ? (
        <div className="u-card sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-card bg-ink px-4 py-2 text-white">
          <span className="u-micro-strong">{t('admin.agents.selectedCount', { count: selected.size })}</span>
          {status === 'pending' || status === 'rejected' ? (
            <button type="button" disabled={pending} onClick={() => decide([...selected], 'approve')} className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-2.5 hover:bg-white/25">
              <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.moderation.approveSelected')}
            </button>
          ) : null}
          {status === 'pending' ? (
            <button type="button" disabled={pending} onClick={() => setRejecting([...selected])} className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-2.5 hover:bg-white/25">
              <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.moderation.rejectSelected')}
            </button>
          ) : null}
          <button type="button" onClick={() => setSelected(new Set())} className="u-micro ml-auto text-white/75 hover:text-white">
            {t('admin.agents.clearSelection')}
          </button>
        </div>
      ) : null}

      <TableFrame minWidth="78rem" footer={footer} busy={pending}>
        <thead>
          <tr>
            {canModerate && decidable ? (
              <th className={`${TH_STICKY} w-8`}>
                <input
                  type="checkbox"
                  aria-label={t('admin.moderation.selectPage')}
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(pageIds))}
                  className="h-4 w-4 accent-blue"
                />
              </th>
            ) : null}
            <th className={TH_STICKY}>{t('admin.moderation.colListing')}</th>
            <th className={TH_STICKY}>{t('admin.moderation.colAgent')}</th>
            <th className={TH_STICKY}>{t('admin.moderation.colCommune')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.moderation.colPrice')}</th>
            <th className={TH_STICKY}>{t('admin.moderation.colQuality')}</th>
            <th className={TH_STICKY}>{status === 'pending' ? t('admin.moderation.colWaiting') : t('admin.moderation.colDecision')}</th>
            <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8}>{t('admin.listings.empty')}</EmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className={`${TR_DENSE} ${selected.has(row.id) ? 'bg-blue-tint/40' : ''}`}>
                {canModerate && decidable ? (
                  <td className={TD_DENSE}>
                    <input
                      type="checkbox"
                      aria-label={t('admin.moderation.selectListing', { id: row.id })}
                      checked={selected.has(row.id)}
                      onChange={() => setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        return next;
                      })}
                      className="h-4 w-4 accent-blue"
                    />
                  </td>
                ) : null}
                <td className={TD_DENSE}>
                  <div className="flex items-start gap-2.5">
                    <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md bg-canvas-alt">
                      {row.featuredImage && !row.featuredImage.includes('noimage') ? (
                        <SafeImage src={row.featuredImage} alt="" fill sizes="64px" className="object-cover" />
                      ) : (
                        <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-ink-25" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link href={`/admin/listings/${row.id}`} className="block max-w-[18rem] truncate font-semibold text-ink hover:text-blue-deep hover:underline">
                        {row.title || t('admin.moderation.untitled')}
                      </Link>
                      <div className="u-tabular text-ink-45">
                        #{row.id}{row.reference ? ` · Réf. ${row.reference}` : ''} · {t('admin.moderation.photoCount', { count: row.photoCount })}
                      </div>
                    </div>
                  </div>
                </td>
                <td className={TD_DENSE}>
                  {row.agentId ? (
                    <Link href={`/admin/agents/${row.agentId}`} className="flex items-center gap-1 text-ink hover:text-blue-deep hover:underline">
                      <span className="max-w-[10rem] truncate">{row.agentName || `#${row.agentId}`}</span>
                      {row.agentVerified ? <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 text-success" /> : null}
                    </Link>
                  ) : (
                    <span className="text-ink-35">{t('admin.actions.unassigned')}</span>
                  )}
                  {row.agentPhone ? <div className="u-tabular text-ink-45">+{row.agentPhone}</div> : null}
                </td>
                <td className={TD_DENSE}>
                  {row.commune || <span className="text-ink-35">—</span>}
                  {row.quartier ? <div className="max-w-[9rem] truncate text-ink-45">{row.quartier}</div> : null}
                </td>
                <td className={TD_DENSE_RIGHT}>
                  <span className="whitespace-nowrap">{row.price ? formatPrice(row.price, row.purpose, row.pricePeriod) : '—'}</span>
                  {row.outlier ? (
                    <div className="text-warning" title={t('admin.moderation.outlierTooltip', { median: Math.round(row.outlier.median), sample: row.outlier.sample })}>
                      ×{row.outlier.ratio}
                    </div>
                  ) : null}
                </td>
                <td className={TD_DENSE}>
                  {row.flags.length === 0 ? (
                    <Chip tone="success">{t('admin.moderation.noIssues')}</Chip>
                  ) : (
                    <div className="flex max-w-[16rem] flex-wrap gap-1">
                      {row.blocking ? <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-danger" aria-label={t('admin.moderation.blocking')} /> : null}
                      {row.flags.map((flag) => (
                        <Chip key={flag} tone={['missing_price', 'missing_content', 'extraction_failure', 'duplicate_photo', 'duplicate_listing'].includes(flag) ? 'danger' : 'warning'}>
                          {t(QUALITY_FLAG_LABEL_KEYS[flag])}
                        </Chip>
                      ))}
                    </div>
                  )}
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>
                  {status === 'pending' ? (
                    <span className={renderedAt - new Date(row.createdAt).getTime() > DAY_MS ? 'font-semibold text-danger' : ''}>
                      {waiting(row.createdAt, t, renderedAt)}
                    </span>
                  ) : (
                    <>
                      {row.moderationReasonCode ? <div className="text-ink">{t(REJECTION_REASON_LABEL_KEYS[row.moderationReasonCode])}</div> : null}
                      <div className="text-ink-45">
                        {row.moderatedAt ? new Date(row.moderatedAt).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' }) : '—'}
                        {row.moderatedByName ? ` · ${row.moderatedByName}` : ''}
                      </div>
                    </>
                  )}
                </td>
                <td className={TD_DENSE}>
                  <div className="flex items-center gap-1.5">
                    {canModerate && decidable ? (
                      <button type="button" className={BUTTON} disabled={pending} onClick={() => decide([row.id], 'approve')} title={t('admin.actions.approve')}>
                        <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" />
                      </button>
                    ) : null}
                    {canModerate && status === 'pending' ? (
                      <button type="button" className={BUTTON} disabled={pending} onClick={() => setRejecting([row.id])} title={t('admin.moderation.reject')}>
                        <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-danger" />
                      </button>
                    ) : null}
                    <Link href={`/admin/listings/${row.id}`} className={BUTTON} title={t('admin.moderation.open')}>
                      <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </TableFrame>

      <Dialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.moderation.rejectTitle')}</DialogTitle>
            <DialogDescription>{t('admin.moderation.rejectBody', { count: rejecting?.length || 0 })}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1">
            <span className="u-eyebrow text-ink-45">{t('admin.moderation.reasonLabel')}</span>
            <select
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              className="u-focus-ring u-micro h-9 rounded-lg border border-line bg-surface px-2.5 text-ink"
            >
              <option value="">{t('admin.actions.choose')}</option>
              {REJECTION_REASON_CODES.map((code) => (
                <option key={code} value={code}>{t(REJECTION_REASON_LABEL_KEYS[code])}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="u-eyebrow text-ink-45">{t('admin.moderation.noteLabel')}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t('admin.moderation.notePlaceholder')}
              className="u-focus-ring rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
            />
          </label>
          <p className="u-micro text-ink-45">{t('admin.moderation.agentWillBeTold')}</p>
          <DialogFooter>
            <button type="button" className={BUTTON} onClick={() => setRejecting(null)}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              disabled={pending || !reasonCode}
              onClick={() => decide(rejecting, 'reject', { reasonCode, note })}
              className="u-press inline-flex h-8 items-center rounded-md bg-danger px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t('admin.moderation.confirmReject')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
