'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight, BadgeCheck, Camera, Check, CheckCircle2, Copy, ImageOff, MoreHorizontal, Pencil, Phone, Trash2, Video, XCircle,
} from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { BLOCKING_FLAGS, QUALITY_FLAG_LABEL_KEYS, REJECTION_REASON_CODES, REJECTION_REASON_LABEL_KEYS } from '@/lib/moderation';
import {
  agentFacts, agentHeadline, agentSubline, checkFlags, duplicateSummary, initials, photoTone,
} from '@/lib/moderationRow';
import { placeLabel } from '@/lib/placeLabel';
import { useT } from '@/lib/i18n/client';
import { compareHref } from '@/lib/listingCompare';
import { Chip } from '../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import { moderateListingsAction } from './actions';
import { BulkDeleteButton, useBulkDelete } from '../BulkDelete';
import TeamSocialShare from './TeamSocialShare';

/** "6 nov." in Kinshasa time, the same on server and browser. */
function shortDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'short' });
}

const BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-ink transition-colors hover:border-blue disabled:opacity-50';
const ICON_BUTTON =
  'u-press inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink-70 transition-colors hover:border-blue hover:text-ink disabled:opacity-50';
const APPROVE_BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1 rounded-md border border-success/40 bg-success-tint px-2.5 text-success transition-colors hover:border-success disabled:opacity-50';

const DAY_MS = 24 * 3600 * 1000;

const PHOTO_BADGE = {
  plain: 'bg-ink/70 text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
};

/** Waiting time measured against the server's render time, so server and browser print the same text. */
function waiting(iso, t, now) {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t('admin.moderation.waitMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('admin.moderation.waitHours', { count: hours });
  return t('admin.moderation.waitDays', { count: Math.round(hours / 24) });
}

/** +243 828 553 557 for a DRC number; other countries as stored. */
function phoneLabel(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  const drc = /^243(\d{3})(\d{3})(\d{3})$/.exec(value);
  return drc ? `+243 ${drc[1]} ${drc[2]} ${drc[3]}` : `+${value}`;
}

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

/** Photo, title, place, id and reference. The photo count sits on the photo, amber or red when short. */
function ListingCell({ row, t }) {
  const place = placeLabel({ quartier: row.quartier, commune: row.commune });
  const hasImage = row.featuredImage && !row.featuredImage.includes('noimage');
  return (
    <div className="flex min-w-0 items-start gap-3">
      <Link href={`/admin/listings/${row.id}`} className="relative h-14 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-canvas-alt" tabIndex={-1} aria-hidden="true">
        {hasImage ? (
          <SafeImage src={row.featuredImage} alt="" fill sizes="72px" className="object-cover" />
        ) : (
          <ImageOff strokeWidth={ICON_STROKE_WIDTH} className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-ink-25" />
        )}
        <span
          className={`u-tabular absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded px-1 text-[0.625rem] font-bold leading-4 ${PHOTO_BADGE[photoTone(row)]}`}
          title={t('admin.moderation.photoCount', { count: row.photoCount })}
        >
          <Camera strokeWidth={2} className="h-2.5 w-2.5" />
          {row.photoCount}
          {row.videoCount ? (
            <>
              <Video strokeWidth={2} className="ml-0.5 h-2.5 w-2.5" />
              {row.videoCount}
            </>
          ) : null}
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/admin/listings/${row.id}`} className="block truncate font-semibold text-ink hover:text-blue-deep hover:underline">
          {row.title || t('admin.moderation.untitled')}
        </Link>
        <div className="truncate text-ink-70">
          {place || <span className="font-semibold text-warning">{t(QUALITY_FLAG_LABEL_KEYS.missing_commune)}</span>}
        </div>
        <div className="u-tabular truncate text-ink-35">
          #{row.id}{row.reference ? ` · Réf. ${row.reference}` : ''}
        </div>
      </div>
    </div>
  );
}

/**
 * Who sent it: the person (or agency), the agency when it differs, the number
 * to call, and what the moderator should know about the account — unverified,
 * created this week, first listing — or how many listings it has.
 */
function AgentCell({ row, t, now }) {
  if (!row.agentId) return <div><Chip tone="danger">{t(QUALITY_FLAG_LABEL_KEYS.no_agent)}</Chip></div>;
  const headline = agentHeadline(row);
  const subline = agentSubline(row);
  const facts = agentFacts(row, now);
  const name = headline || t('admin.moderation.row.agentFallback', { id: row.agentId });
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-tint text-[0.6875rem] font-bold text-blue-deep" aria-hidden="true">
        {initials(headline)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <Link href={`/admin/agents/${row.agentId}`} className="truncate font-semibold text-ink hover:text-blue-deep hover:underline" title={name}>
            {name}
          </Link>
          {row.agentVerified ? (
            <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0 text-success" aria-label={t('admin.moderation.row.verifiedNumber')} />
          ) : null}
        </div>
        {subline ? <div className="truncate text-ink-45" title={subline}>{subline}</div> : null}
        {row.agentPhone ? (
          <a href={`tel:+${String(row.agentPhone).replace(/\D/g, '')}`} className="u-tabular inline-flex items-center gap-1 text-ink-45 hover:text-blue-deep">
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" aria-hidden="true" />
            {phoneLabel(row.agentPhone)}
          </a>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {!row.agentVerified ? <Chip tone="warning">{t('admin.moderation.row.unverifiedNumber')}</Chip> : null}
          {facts.newAccount ? (
            <span title={row.agentCreatedAt ? t('admin.moderation.row.joinedOn', { date: shortDate(row.agentCreatedAt) }) : undefined}>
              <Chip tone="warning">{t('admin.moderation.row.newAccount')}</Chip>
            </span>
          ) : null}
          {facts.firstListing ? (
            <Chip tone="warning">{t('admin.moderation.row.firstListing')}</Chip>
          ) : facts.listingCount != null ? (
            <span className="u-tabular text-ink-35">{t('admin.moderation.row.listingCount', { count: facts.listingCount })}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PriceCell({ row, t }) {
  return (
    <>
      {row.price ? (
        <span className="whitespace-nowrap font-semibold text-ink">{formatPrice(row.price, row.purpose, row.pricePeriod)}</span>
      ) : (
        <span className="font-semibold text-danger">{t(QUALITY_FLAG_LABEL_KEYS.missing_price)}</span>
      )}
      {row.outlier ? (
        <div
          className="whitespace-nowrap text-warning"
          title={t('admin.moderation.outlierTooltip', { median: Math.round(row.outlier.median), sample: row.outlier.sample })}
        >
          {t('admin.moderation.row.vsMedian', { ratio: row.outlier.ratio })}
        </div>
      ) : null}
    </>
  );
}

/**
 * What is left to look at: one link for every listing this one matches
 * (red only when it is the same agent again), then the flags no other cell
 * already shows. "Rien à signaler" when there is nothing.
 */
function ChecksCell({ row, t }) {
  const duplicate = duplicateSummary(row);
  const others = checkFlags(row.flags);
  if (!duplicate && !others.length) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-success">
        <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.moderation.noIssues')}
      </span>
    );
  }
  const ids = duplicate ? duplicate.ids.map((id) => `#${id}`).join(', ') : '';
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {duplicate ? (
        <Link
          href={compareHref(row.id, duplicate.ids)}
          title={duplicate.reasons.map((flag) => t(QUALITY_FLAG_LABEL_KEYS[flag])).join(' · ')}
          className={`flex w-full flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-[0.6875rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue ${
            duplicate.danger
              ? 'border-danger/40 bg-danger-tint text-danger hover:border-danger'
              : 'border-line bg-surface text-ink-70 hover:border-blue'
          }`}
        >
          <span className="flex items-start gap-1.5 font-semibold leading-tight">
            <Copy strokeWidth={ICON_STROKE_WIDTH} className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {duplicate.danger
                ? t(QUALITY_FLAG_LABEL_KEYS.same_agent_resend)
                : t('admin.moderation.row.duplicateLabel', {
                  whose: t(duplicate.sameAgent ? 'admin.moderation.compare.sameAgentShort' : 'admin.moderation.compare.otherAgentShort'),
                })}
            </span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className="u-tabular min-w-0 truncate" title={ids}>{ids}</span>
            <span className="inline-flex shrink-0 items-center font-semibold text-blue underline underline-offset-2">
              {t('admin.moderation.compare.compareLink')}
              <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" aria-hidden="true" />
            </span>
          </span>
        </Link>
      ) : null}
      {others.length ? (
        <div className="flex flex-wrap gap-1">
          {others.map((flag) => (
            <Chip key={flag} tone={BLOCKING_FLAGS.has(flag) ? 'danger' : 'warning'}>{t(QUALITY_FLAG_LABEL_KEYS[flag])}</Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WhenCell({ row, status, t, now }) {
  if (status === 'pending') {
    const late = now - new Date(row.createdAt).getTime() > DAY_MS;
    return (
      <>
        <span className={late ? 'font-semibold text-danger' : 'font-semibold text-ink'}>{waiting(row.createdAt, t, now)}</span>
        {row.createdAt ? <div className="text-ink-35">{shortDate(row.createdAt)}</div> : null}
      </>
    );
  }
  return (
    <>
      {row.moderationReasonCode ? <div className="text-ink">{t(REJECTION_REASON_LABEL_KEYS[row.moderationReasonCode])}</div> : null}
      <div className="text-ink-45">
        {row.moderatedAt ? new Date(row.moderatedAt).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa' }) : '—'}
        {row.moderatedByName ? ` · ${row.moderatedByName}` : ''}
      </div>
    </>
  );
}

/**
 * One page of the approval queue with row selection and the two decisions.
 * Approving many runs the publishability check per listing and reports the
 * ones it skipped; rejecting many asks for one reason that every selected
 * agent is told. Table from `md`, one card per listing on a phone.
 */
export default function ModerationTable({ rows, status, canModerate, canDelete = false, footer, renderedAt, socialPosts = null }) {
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
  const canDecide = canModerate && decidable;
  // Delete works on every tab; approve / reject only where a decision is open.
  const selectable = canDecide || canDelete;
  const bulkDelete = useBulkDelete('listing', { onDeleted: () => setSelected(new Set()) });
  // The live tab carries the team's social post per row and where it already went.
  const live = status === 'approved';
  const columns = 6 + (selectable ? 1 : 0);

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

      {/* From md: the table. */}
      <div className="hidden md:block">
        <TableFrame minWidth="60rem" footer={footer} busy={pending}>
          <thead>
            <tr>
              {selectable ? (
                <th className={TH_STICKY}>
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
              <th className={TH_STICKY_RIGHT}>{t('admin.moderation.colPrice')}</th>
              <th className={TH_STICKY}>{t('admin.moderation.colQuality')}</th>
              {/* The live tab trades the decision date for where the team posted it. */}
              {live ? null : <th className={TH_STICKY}>{status === 'pending' ? t('admin.moderation.colWaiting') : t('admin.moderation.colDecision')}</th>}
              {live ? <th className={TH_STICKY}>{t('admin.social.colPosted')}</th> : null}
              <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={columns}>{t('admin.listings.empty')}</EmptyRow>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={`${TR_DENSE} ${selected.has(row.id) ? 'bg-blue-tint/40' : ''}`}>
                  {selectable ? <td className={`${TD_DENSE} py-3`}>{selectBox(row)}</td> : null}
                  <td className={`${TD_DENSE} py-3`}><div className="w-[15rem]"><ListingCell row={row} t={t} /></div></td>
                  <td className={`${TD_DENSE} py-3`}><div className="w-[12rem]"><AgentCell row={row} t={t} now={renderedAt} /></div></td>
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
        {rows.length === 0 ? (
          <p className="u-card u-micro rounded-card bg-surface px-4 py-10 text-center text-ink-45">{t('admin.listings.empty')}</p>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className={`u-card u-micro flex flex-col gap-3 rounded-card bg-surface p-3 text-ink-70 ${selected.has(row.id) ? 'ring-2 ring-blue/40' : ''}`}
            >
              <div className="flex items-start gap-2">
                {selectable ? <div className="pt-1">{selectBox(row)}</div> : null}
                <div className="min-w-0 flex-1"><ListingCell row={row} t={t} /></div>
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
        {footer ? <div className="u-card overflow-hidden rounded-card bg-surface">{footer}</div> : null}
      </div>

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
