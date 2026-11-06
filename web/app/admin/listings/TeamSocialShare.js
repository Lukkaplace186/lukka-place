'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Share2 } from 'lucide-react';
import ListingQuickShare from '@/components/ListingQuickShare';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { TEAM_SOCIAL_TARGETS, resolveTeamSocialTarget } from '@/lib/teamSocialTargets';
import { getTeamSocialPostsAction, recordTeamSocialPostAction } from './shareActions';

const OTHER = '__other__';

function postDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'short' });
}

/**
 * Lukka Place's own social post of one listing (2026-11-06): the team's
 * "Carte réseaux sociaux" dialog (ListingQuickShare, audience "team") plus
 * WHERE it is being posted. Picking a group or page puts that place's link in
 * the caption (utm_campaign = the place, lib/teamSocialTargets.js) and asks
 * Facebook to read that link; "Marquer comme publié" records it in
 * team_social_posts, so /admin/listings can show where each listing already
 * went and list the ones not yet posted in a group.
 *
 * Opened from /admin/listings/[id] (`variant="button"`) and from each row of
 * the "Approuvées" tab (`variant="icon"`). Live listings only — the caller
 * decides, since the card's link leads to the public page.
 */
export default function TeamSocialShare({ listing, variant = 'button' }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [otherLabel, setOtherLabel] = useState('');
  const [history, setHistory] = useState({ id: null, posts: undefined }); // undefined: loading; null: unknown
  const [pending, startTransition] = useTransition();

  const posts = history.id === listing.id ? history.posts : undefined;
  const target = choice === OTHER
    ? resolveTeamSocialTarget({ label: otherLabel })
    : choice ? resolveTeamSocialTarget({ key: choice }) : null;
  const already = target && Array.isArray(posts) ? posts.find((post) => post.targetKey === target.key) : null;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getTeamSocialPostsAction(listing.id)
      .then((result) => {
        if (!cancelled) setHistory({ id: listing.id, posts: result?.ok ? result.posts : null });
      })
      .catch(() => {
        if (!cancelled) setHistory({ id: listing.id, posts: null });
      });
    return () => {
      cancelled = true;
    };
  }, [open, listing.id]);

  function handleOpenChange(next) {
    if (!next) {
      setChoice('');
      setOtherLabel('');
    }
    setOpen(next);
  }

  function markPosted() {
    if (!target) return;
    startTransition(async () => {
      let result;
      try {
        result = await recordTeamSocialPostAction({ listingId: listing.id, target: { key: target.key, label: target.label } });
      } catch {
        result = { ok: false, reason: 'error' };
      }
      if (result?.ok) {
        setHistory((current) => ({ id: listing.id, posts: [result.post, ...(Array.isArray(current.posts) ? current.posts : [])] }));
        showToast({ type: 'success', message: t('admin.social.marked', { place: target.label }) });
        router.refresh();
        return;
      }
      const key = {
        duplicate: 'admin.social.errorDuplicate',
        not_public: 'admin.social.errorNotPublic',
        not_ready: 'admin.social.errorNotReady',
        invalid: 'admin.social.errorInvalid',
      }[result?.reason] || 'errors.actionFailed';
      showToast({ type: 'error', message: t(key, { date: result?.post ? postDate(result.post.postedAt) : '' }) });
    });
  }

  const field = 'u-focus-ring u-micro h-10 w-full rounded-lg border border-line bg-surface px-2.5 text-ink';
  const slot = (
    <div className="flex flex-col gap-2 rounded-xl bg-canvas-alt p-3">
      <label className="flex flex-col gap-1">
        <span className="u-title-sub text-ink">{t('admin.social.whereLabel')}</span>
        <select value={choice} onChange={(event) => setChoice(event.target.value)} className={field}>
          <option value="">{t('admin.social.wherePlaceholder')}</option>
          <optgroup label={t('admin.social.ourPages')}>
            {TEAM_SOCIAL_TARGETS.filter((item) => item.kind === 'page').map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </optgroup>
          <optgroup label={t('admin.social.groups')}>
            {TEAM_SOCIAL_TARGETS.filter((item) => item.kind === 'group').map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </optgroup>
          <option value={OTHER}>{t('admin.social.other')}</option>
        </select>
      </label>
      {choice === OTHER ? (
        <label className="flex flex-col gap-1">
          <span className="u-micro text-ink-70">{t('admin.social.otherLabel')}</span>
          <input
            type="text"
            value={otherLabel}
            maxLength={120}
            onChange={(event) => setOtherLabel(event.target.value)}
            className={field}
          />
        </label>
      ) : null}
      {target ? <p className="u-micro text-ink-70">{t('admin.social.captionLinkHint')}</p> : null}
      {target?.url ? (
        <a href={target.url} target="_blank" rel="noopener noreferrer" className="u-micro-strong inline-flex items-center gap-1 text-blue-deep hover:underline">
          {t('admin.social.openGroup')}
          <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
      {already ? (
        <p className="u-micro font-semibold text-warning" role="status">
          {t('admin.social.alreadyHere', { date: postDate(already.postedAt), name: already.postedBy || t('admin.social.someone') })}
        </p>
      ) : null}
      <button
        type="button"
        onClick={markPosted}
        disabled={!target || pending || posts === null}
        className="u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-3 text-sm font-bold text-white disabled:opacity-50"
      >
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t('admin.social.markPosted')}
      </button>
      <p className="u-micro text-ink-45">{t('admin.social.markHint')}</p>
      {posts === null ? <p className="u-micro text-ink-45">{t('admin.social.historyUnavailable')}</p> : null}
      {Array.isArray(posts) && posts.length ? (
        <div className="flex flex-col gap-1">
          <span className="u-eyebrow text-ink-45">{t('admin.social.historyTitle')}</span>
          <ul className="flex flex-col gap-0.5">
            {posts.slice(0, 8).map((post) => (
              <li key={post.id} className="u-micro text-ink-70">
                {post.targetLabel} · {postDate(post.postedAt)}{post.postedBy ? ` · ${post.postedBy}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t('admin.moderation.socialCard')}
          aria-label={t('admin.moderation.socialCard')}
          className="u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-blue-deep transition-colors hover:border-blue"
        >
          <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="u-press inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-semibold text-blue-deep ring-1 ring-inset ring-ink-25 hover:bg-canvas-alt"
        >
          <Share2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('admin.moderation.socialCard')}
        </button>
      )}
      <ListingQuickShare
        listing={listing}
        open={open}
        onOpenChange={handleOpenChange}
        audience="team"
        teamTarget={target}
        teamSlot={slot}
      />
    </>
  );
}
