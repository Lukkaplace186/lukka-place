'use client';

/**
 * The pieces of one approval-queue listing, shared by the queue
 * (ModerationTable.js) and review mode (review/ReviewMode.js), so a fact reads
 * the same in both. Rules behind each piece: lib/moderationRow.js.
 */
import Link from 'next/link';
import { ArrowUpRight, BadgeCheck, Camera, CheckCircle2, Copy, ImageOff, Phone, Video } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { BLOCKING_FLAGS, QUALITY_FLAG_LABEL_KEYS, REJECTION_REASON_LABEL_KEYS } from '@/lib/moderation';
import {
  agentFacts, agentHeadline, agentSubline, checkFlags, duplicateSummary, initials, nameLooksLikeSentence, photoTone,
} from '@/lib/moderationRow';
import { placeLabel } from '@/lib/placeLabel';
import { compareHref } from '@/lib/listingCompare';
import { Chip } from '../LeadRoutingUI';

const DAY_MS = 24 * 3600 * 1000;

/** "6 nov." in Kinshasa time, the same on server and browser. */
export function shortDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'short' });
}

/** "lundi 3 novembre à 14:12", Kinshasa time. */
function longDateTime(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Africa/Kinshasa', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

/** Waiting time measured against the server's render time, so server and browser print the same text. */
export function waiting(iso, t, now) {
  if (!iso) return '—';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return ageLabel(minutes, t);
}

/** "12 min", "3 h", "2 j". */
export function ageLabel(minutes, t) {
  if (minutes < 60) return t('admin.moderation.waitMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('admin.moderation.waitHours', { count: hours });
  return t('admin.moderation.waitDays', { count: Math.round(hours / 24) });
}

/** +243 828 553 557 for a DRC number; other countries as stored. */
export function phoneLabel(digits) {
  const value = String(digits || '').replace(/\D/g, '');
  const drc = /^243(\d{3})(\d{3})(\d{3})$/.exec(value);
  return drc ? `+243 ${drc[1]} ${drc[2]} ${drc[3]}` : `+${value}`;
}

const PHOTO_BADGE = {
  plain: 'bg-ink/70 text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
};

/**
 * Photo, title, the agent's first words in grey, place, id and reference.
 * The photo count sits on the photo, amber or red when short; tapping the
 * photo opens every photo (`onOpenPhotos`) without leaving the list.
 */
export function ListingCell({ row, t, textLine = null, onOpenPhotos = null }) {
  const place = placeLabel({ quartier: row.quartier, commune: row.commune });
  const hasImage = row.featuredImage && !row.featuredImage.includes('noimage');
  const thumbClass = 'relative h-14 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-canvas-alt';
  const thumb = (
    <>
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
    </>
  );
  return (
    <div className="flex min-w-0 items-start gap-3">
      {onOpenPhotos && row.photos?.length ? (
        <button
          type="button"
          onClick={onOpenPhotos}
          className={`${thumbClass} cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue`}
          aria-label={t('admin.moderation.viewer.open', { id: row.id })}
        >
          {thumb}
        </button>
      ) : (
        <Link href={`/admin/listings/${row.id}`} className={thumbClass} tabIndex={-1} aria-hidden="true">
          {thumb}
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <Link href={`/admin/listings/${row.id}`} className="block truncate font-semibold text-ink hover:text-blue-deep hover:underline">
          {row.title || t('admin.moderation.untitled')}
        </Link>
        {textLine ? <div className="truncate italic text-ink-35" title={textLine}>« {textLine} »</div> : null}
        <div className="truncate text-ink-70">
          {place || <span className="font-semibold text-warning">{t(QUALITY_FLAG_LABEL_KEYS.missing_commune)}</span>}
          <span className="u-tabular text-ink-35"> · #{row.id}{row.reference ? ` · Réf. ${row.reference}` : ''}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Who sent it: the person (or agency), the agency when it differs, the number
 * to call, and what the moderator should know about the account — unverified,
 * created this week, first listing, a name that reads like a message — or how
 * many listings it has.
 */
export function AgentCell({ row, t, now, size = 'sm' }) {
  if (!row.agentId) return <div><Chip tone="danger">{t(QUALITY_FLAG_LABEL_KEYS.no_agent)}</Chip></div>;
  const headline = agentHeadline(row);
  const subline = agentSubline(row);
  const facts = agentFacts(row, now);
  const name = headline || t('admin.moderation.row.agentFallback', { id: row.agentId });
  const large = size === 'lg';
  return (
    <div className={`flex min-w-0 items-start ${large ? 'gap-3' : 'gap-2.5'}`}>
      <span
        className={`grid shrink-0 place-items-center rounded-full bg-blue-tint font-bold text-blue-deep ${large ? 'h-10 w-10 text-xs' : 'h-8 w-8 text-[0.6875rem]'}`}
        aria-hidden="true"
      >
        {initials(headline)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          <Link
            href={`/admin/agents/${row.agentId}`}
            className={`font-semibold text-ink hover:text-blue-deep hover:underline ${large ? '' : 'truncate'}`}
            title={name}
          >
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
          {nameLooksLikeSentence(row.agentName) ? <Chip tone="danger">{t('admin.moderation.row.nameLooksLikeSentence')}</Chip> : null}
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

export function PriceCell({ row, t }) {
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
 * already shows. "Aucun signal" when there is nothing.
 */
export function ChecksCell({ row, t }) {
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

/**
 * Pending: how long it has waited (red after a day) and the day it came in.
 * Decided: the reason, then only the date; who decided, when exactly and
 * their note open on hover or tap, so the row stays one line tall.
 */
export function WhenCell({ row, status, t, now }) {
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
      {row.moderatedAt ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-ink-45 underline decoration-dotted underline-offset-2 hover:text-ink"
              title={row.moderatedByName ? t('admin.moderation.decidedBy', { name: row.moderatedByName }) : undefined}
            >
              {shortDate(row.moderatedAt)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="u-micro w-64 text-ink-70">
            <p className="font-semibold text-ink">
              {row.moderatedByName ? t('admin.moderation.decidedBy', { name: row.moderatedByName }) : t('admin.moderation.decidedByUnknown')}
            </p>
            <p>{longDateTime(row.moderatedAt)}</p>
            {row.moderationNote ? <p className="mt-1 text-ink-45">{t('admin.moderation.noteQuoted', { note: row.moderationNote })}</p> : null}
          </PopoverContent>
        </Popover>
      ) : (
        <div className="text-ink-35">—</div>
      )}
    </>
  );
}
