'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, CheckCircle2, MoreHorizontal, Pencil, Play, Trash2, XCircle } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { agentTextLine, splitQueue } from '@/lib/moderationRow';
import { useT } from '@/lib/i18n/client';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import { moderateListingsAction } from './actions';
import { BulkDeleteButton, useBulkDelete } from '../BulkDelete';
import TeamSocialShare from './TeamSocialShare';
import { AgentCell, ChecksCell, ListingCell, PriceCell, WhenCell, shortDate } from './ModerationCells';
import PhotoViewer from './PhotoViewer';
import RejectReasons from './RejectReasons';

const BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink transition-colors hover:border-blue disabled:opacity-50';
const ICON_BUTTON =
  'u-press inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink-70 transition-colors hover:border-blue hover:text-ink disabled:opacity-50';
const APPROVE_BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1 rounded-md border border-success/40 bg-success-tint px-2.5 text-success transition-colors hover:border-success disabled:opacity-50';

/**
 * "Publié sur" on the live tab: the places the team marked this listing as
 * posted (team_social_posts), newest first, at most three named. `null` is
 * "not known" (table not there yet), which is not the same as "nowhere".
 */
function SocialPostsCell({ posts, t }) {
  if (posts === null) return <span className="text-ink-35">—</span>;
  if (!posts.length) return <span className="text-ink-45">{t('admin.social.notPosted')}</span>;
  const shown = posts.slice(0, 3);
  return (
    <div className="flex max-w-[14rem] flex-col gap-0.5">
      {shown.map((post) => (
        <span key={post.id} className="truncate text-ink" title={post.postedBy ? `${post.targetLabel} · ${post.postedBy}` : post.targetLabel}>
          {post.targetLabel} <span className="text-ink-45">· {shortDate(post.postedAt)}</span>
        </span>
      ))}
      {posts.length > shown.length ? (
        <span className="text-ink-45">{t('admin.social.morePlaces', { count: posts.length - shown.length })}</span>
      ) : null}
    </div>
  );
}

/**
 * One page of the approval queue with row selection and the two decisions.
 * Approving many runs the publishability check per listing and reports the
 * ones it skipped; rejecting many asks for one reason that every selected
 * agent is told. Table from `md`, one card per listing on a phone.
 */
export default function ModerationTable({
  rows, status, canModerate, canDelete = false, footer, renderedAt, socialPosts = null, sources = null, split = false,
}) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(null); // array of ids
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [viewerRow, setViewerRow] = useState(null);

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const decidable = status === 'pending' || status === 'rejected';
  const canDecide = canModerate && decidable;
  // Delete works on every tab; approve / reject only where a decision is open.
  const selectable = canDecide || canDelete;
  const bulkDelete = useBulkDelete('listing', { onDeleted: () => setSelected(new Set()) });
  // The live tab carries the team's social post per row and where it already went.
  const live = status === 'approved';
  const columns = 6 + (selectable ? 1 : 0);
  // Pending tab: "À vérifier" first, then "Prêtes" with one button for all (lib/moderationRow.js readiness).
  const groups = useMemo(() => {
    if (!split || status !== 'pending') return [{ key: 'all', rows }];
    const { check, ready } = splitQueue(rows, renderedAt);
    return [{ key: 'check', rows: check }, { key: 'ready', rows: ready }];
  }, [split, status, rows, renderedAt]);
  const textLine = (row) => agentTextLine(sources?.[row.id], row);

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      setViewerRow(null);
      setReasonCode('');
      setNote('');
      router.refresh();
    });
  }

  function rowActions(row, compactActions = false) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        {live ? (
          <TeamSocialShare
            variant="icon"
            listing={{
              id: row.id,
              title: row.title,
              price: row.price,
              purpose: row.purpose,
              price_period: row.pricePeriod,
              featured_image: row.featuredImage,
              updated_at: row.updatedAt,
            }}
          />
        ) : null}
        {canDecide ? (
          <button type="button" className={APPROVE_BUTTON} disabled={pending} onClick={() => decide([row.id], 'approve')} title={t('admin.actions.approve')}>
            <Check strokeWidth={2.25} className="h-3.5 w-3.5" aria-hidden="true" />
            <span className={compactActions ? 'sr-only' : ''}>{t('admin.actions.approve')}</span>
          </button>
        ) : null}
        {canModerate && status === 'pending' ? (
          <button
            type="button"
            className={`${ICON_BUTTON} hover:border-danger hover:text-danger`}
            disabled={pending}
            onClick={() => setRejecting([row.id])}
            title={t('admin.moderation.reject')}
            aria-label={t('admin.moderation.reject')}
          >
            <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ICON_BUTTON} disabled={pending} aria-label={t('admin.table.moreActions')}>
              <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem asChild>
              <Link href={`/admin/listings/${row.id}`}>
                <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('admin.moderation.open')}
              </Link>
            </DropdownMenuItem>
            {canDelete ? (
              <DropdownMenuItem onSelect={() => bulkDelete.request([row.id])} className="text-danger" disabled={bulkDelete.pending}>
                <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('admin.listings.deleteOne')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  function selectBox(row) {
    return (
      <input
        type="checkbox"
        aria-label={t('admin.moderation.selectListing', { id: row.id })}
        checked={selected.has(row.id)}
        onChange={() => toggle(row.id)}
        className="h-4 w-4 accent-blue"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {bulkDelete.dialog}
      {selectable && selected.size > 0 ? (
        <div className="u-card sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-card bg-ink px-4 py-2 text-white">
          <span className="u-micro-strong">{t('admin.agents.selectedCount', { count: selected.size })}</span>
          {canDecide ? (
            <button type="button" disabled={pending} onClick={() => decide([...selected], 'approve')} className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-2.5 hover:bg-white/25">
              <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.moderation.approveSelected')}
            </button>
          ) : null}
          {canDecide && status === 'pending' ? (
            <button type="button" disabled={pending} onClick={() => setRejecting([...selected])} className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md bg-white/15 px-2.5 hover:bg-white/25">
              <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.moderation.rejectSelected')}
            </button>
          ) : null}
          {canDelete ? <BulkDeleteButton disabled={pending || bulkDelete.pending} onClick={() => bulkDelete.request(selected)} /> : null}
          <button type="button" onClick={() => setSelected(new Set())} className="u-micro ml-auto text-white/75 hover:text-white">
            {t('admin.agents.clearSelection')}
          </button>
        </div>
      ) : null}

      {groups.map((group, groupIndex) => {
        const last = groupIndex === groups.length - 1;
        const groupIds = group.rows.map((row) => row.id);
        const groupAllSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
        return (
          <section key={group.key} aria-labelledby={group.key === 'all' ? undefined : `queue-${group.key}`} className="flex flex-col gap-2">
            {group.key === 'all' ? null : (
              <GroupHeader
                group={group}
                t={t}
                canDecide={canDecide}
                pending={pending}
                onApproveAll={() => decide(groupIds, 'approve')}
              />
            )}
            {group.key !== 'all' && group.rows.length === 0 ? null : (
              <>
                {/* From md: the table. */}
                <div className="hidden md:block">
                  <TableFrame minWidth="60rem" footer={last ? footer : null} busy={pending}>
                    <thead>
                      <tr>
                        {selectable ? (
                          <th className={TH_STICKY}>
                            <input
                              type="checkbox"
                              aria-label={t('admin.moderation.selectPage')}
                              checked={groupAllSelected}
                              onChange={() => setSelected((current) => {
                                const next = new Set(current);
                                for (const id of groupIds) {
                                  if (groupAllSelected) next.delete(id);
                                  else next.add(id);
                                }
                                return next;
                              })}
                              className="h-4 w-4 accent-blue"
                            />
                          </th>
                        ) : null}
                        <th className={TH_STICKY}>{t('admin.moderation.colListing')}</th>
                        <th className={TH_STICKY}>{t('admin.moderation.colAgent')}</th>
                        <th className={TH_STICKY_RIGHT}>{t('admin.moderation.colPrice')}</th>
                        <th className={TH_STICKY}>{t('admin.moderation.colQuality')}</th>
                        {/* The live tab trades the decision date for where the team posted it. */}
                        {live ? null : <th className={TH_STICKY}>{status === 'pending' ? t('admin.moderation.colWaiting') : t('admin.moderation.colDecision')}</th>}
                        {live ? <th className={TH_STICKY}>{t('admin.social.colPosted')}</th> : null}
                        <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} />
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.length === 0 ? (
                        <EmptyRow colSpan={columns}>{t('admin.listings.empty')}</EmptyRow>
                      ) : (
                        group.rows.map((row) => (
                          <tr key={row.id} className={`${TR_DENSE} ${selected.has(row.id) ? 'bg-blue-tint/40' : ''}`}>
                            {selectable ? <td className={`${TD_DENSE} py-3`}>{selectBox(row)}</td> : null}
                            <td className={`${TD_DENSE} py-3`}>
                              <div className="w-[14.5rem]"><ListingCell row={row} t={t} textLine={textLine(row)} onOpenPhotos={() => setViewerRow(row)} /></div>
                            </td>
                            <td className={`${TD_DENSE} py-3`}><div className="w-[11.5rem]"><AgentCell row={row} t={t} now={renderedAt} /></div></td>
                            <td className={`${TD_DENSE_RIGHT} py-3`}><PriceCell row={row} t={t} /></td>
                            <td className={`${TD_DENSE} py-3`}><div className="w-[13rem]"><ChecksCell row={row} t={t} /></div></td>
                            {live ? null : <td className={`${TD_DENSE} py-3`}><div className="w-[6.5rem]"><WhenCell row={row} status={status} t={t} now={renderedAt} /></div></td>}
                            {live ? (
                              <td className={`${TD_DENSE} py-3`}>
                                <div className="w-[7rem]"><SocialPostsCell posts={socialPosts ? socialPosts[row.id] || [] : null} t={t} /></div>
                              </td>
                            ) : null}
                            <td className={`${TD_DENSE} py-3`}>{rowActions(row, true)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </TableFrame>
                </div>

                {/* On a phone: one card per listing, the same cells stacked. */}
                <div className="flex flex-col gap-2 md:hidden" aria-busy={pending || undefined}>
                  {group.rows.length === 0 ? (
                    <p className="u-card u-micro rounded-card bg-surface px-4 py-10 text-center text-ink-45">{t('admin.listings.empty')}</p>
                  ) : (
                    group.rows.map((row) => (
                      <article
                        key={row.id}
                        className={`u-card u-micro flex flex-col gap-3 rounded-card bg-surface p-3 text-ink-70 ${selected.has(row.id) ? 'ring-2 ring-blue/40' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          {selectable ? <div className="pt-1">{selectBox(row)}</div> : null}
                          <div className="min-w-0 flex-1"><ListingCell row={row} t={t} textLine={textLine(row)} onOpenPhotos={() => setViewerRow(row)} /></div>
                          <div className="shrink-0 text-right"><PriceCell row={row} t={t} /></div>
                        </div>
                        <AgentCell row={row} t={t} now={renderedAt} />
                        <ChecksCell row={row} t={t} />
                        {live ? <SocialPostsCell posts={socialPosts ? socialPosts[row.id] || [] : null} t={t} /> : null}
                        <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                          <div className="min-w-0"><WhenCell row={row} status={status} t={t} now={renderedAt} /></div>
                          {rowActions(row)}
                        </div>
                      </article>
                    ))
                  )}
                  {last && footer ? <div className="u-card overflow-hidden rounded-card bg-surface">{footer}</div> : null}
                </div>
              </>
            )}
          </section>
        );
      })}

      <PhotoViewer
        key={viewerRow?.id ?? 'none'}
        row={viewerRow}
        open={Boolean(viewerRow)}
        onOpenChange={(open) => { if (!open) setViewerRow(null); }}
        busy={pending}
        onApprove={viewerRow && canDecide ? () => decide([viewerRow.id], 'approve') : null}
        onReject={viewerRow && canModerate && status === 'pending' ? () => { setRejecting([viewerRow.id]); setViewerRow(null); } : null}
      />

      <Dialog open={Boolean(rejecting)} onOpenChange={(open) => { if (!open) setRejecting(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('admin.moderation.rejectTitle')}</DialogTitle>
            <DialogDescription>{t('admin.moderation.rejectBody', { count: rejecting?.length || 0 })}</DialogDescription>
          </DialogHeader>
          <RejectReasons value={reasonCode} onChange={setReasonCode} note={note} onNoteChange={setNote} noteId="list-reject-note" />
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

/** "À vérifier · 2 — Revoir ces 2" / "Prêtes · 3 — Tout approuver (3)". */
function GroupHeader({ group, t, canDecide, pending, onApproveAll }) {
  const check = group.key === 'check';
  const count = group.rows.length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-2">
      <div>
        <h2 id={`queue-${group.key}`} className="u-title-card text-ink">
          {t(check ? 'admin.moderation.queue.toCheck' : 'admin.moderation.queue.ready')}{' '}
          <span className={`u-tabular ${check ? 'text-warning' : 'text-success'}`}>· {count}</span>
        </h2>
        <p className="u-micro text-ink-45">{t(check ? 'admin.moderation.queue.toCheckHint' : 'admin.moderation.queue.readyHint')}</p>
      </div>
      {count > 0 && canDecide ? (
        check ? (
          <Link
            href="/admin/listings/review?only=check"
            className="u-press u-micro-strong inline-flex h-10 items-center gap-2 rounded-lg border-[1.5px] border-blue px-3.5 text-blue hover:bg-blue-tint"
          >
            <Play strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('admin.moderation.queue.reviewThese', { count })}
          </Link>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={onApproveAll}
            className="u-press inline-flex h-10 items-center gap-2 rounded-lg bg-success px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            <Check strokeWidth={2.5} className="h-4 w-4" aria-hidden="true" />
            {t('admin.moderation.queue.approveAll', { count })}
          </button>
        )
      ) : null}
    </div>
  );
}
