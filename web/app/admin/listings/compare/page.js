import Link from 'next/link';
import { ArrowLeft, ExternalLink, Pencil } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { getT } from '@/lib/i18n/server';
import { compareState, getListingsForCompare, parseCompareIds } from '@/lib/adminListings';
import { compareToFirst, photoSet } from '@/lib/listingCompare';
import { cn } from '@/lib/utils';
import { Chip } from '../../LeadRoutingUI';
import CompareDecision from './CompareDecision';

export const dynamic = 'force-dynamic';

const STATE_TONE = { live: 'success', pending: 'warning', rejected: 'danger', hidden: 'neutral', deleted: 'danger' };
const PHOTOS_SHOWN = 6;

function shortDate(value) {
  return new Date(value).toLocaleString('fr-FR', {
    timeZone: 'Africa/Kinshasa', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * The duplicate comparison: the listing a moderator came from, next to the
 * listings its "same title and price" or "photo used elsewhere" flag points at
 * (?ids=801,796 — the first is the reference). Facts equal to the first are
 * marked "identique", shared photos are outlined, and a pending listing can be
 * rejected as a duplicate or approved right here.
 */
export default async function CompareListingsPage({ searchParams }) {
  const t = await getT();
  const k = (key, vars) => t(`admin.moderation.compare.${key}`, vars);
  const raw = (await searchParams) || {};
  const ids = parseCompareIds(raw.ids);
  const [session, listings] = await Promise.all([getAdminSession(), getListingsForCompare(ids)]);
  const canModerate = can(session?.role, 'listings.moderate');
  const marks = compareToFirst(listings);
  const reference = listings[0];
  const firstPhotos = reference ? new Set(photoSet(reference)) : new Set();

  const sameChip = (index, field) =>
    index > 0 && marks[index].same.includes(field) ? <Chip tone="danger">{k('same')}</Chip> : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/listings" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue hover:underline">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {k('back')}
        </Link>
        <h1 className="u-title-page text-ink">{k('title')}</h1>
        <p className="max-w-3xl text-sm text-ink-45">{k('intro')}</p>
      </div>

      {listings.length < 2 ? (
        <p className="rounded-card border border-dashed border-line bg-white p-8 text-center text-sm text-ink-45">{k('nothing')}</p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="grid auto-cols-[minmax(280px,1fr)] grid-flow-col gap-4">
            {listings.map((listing, index) => {
              const state = compareState(listing);
              const photos = photoSet(listing);
              const shared = index === 0 ? null : marks[index].sharedPhotos;
              return (
                <article
                  key={listing.id}
                  className={cn(
                    'flex min-w-0 flex-col gap-3 rounded-card border bg-white p-4',
                    index === 0 ? 'border-blue' : 'border-line',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="u-micro-strong text-ink">#{listing.id}</span>
                    <Chip tone={STATE_TONE[state]}>{k(`state.${state}`)}</Chip>
                    {index === 0 ? <Chip tone="blue">{k('reference')}</Chip> : null}
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {photos.slice(0, PHOTOS_SHOWN).map((src) => (
                      <div
                        key={src}
                        className={cn(
                          'relative aspect-square overflow-hidden rounded-md bg-canvas-alt',
                          index > 0 && firstPhotos.has(src) && 'ring-2 ring-danger ring-offset-1',
                        )}
                      >
                        <SafeImage src={src} alt="" fill sizes="120px" className="object-cover" />
                      </div>
                    ))}
                    {photos.length === 0 ? <p className="col-span-3 text-xs text-ink-45">{k('noPhotos')}</p> : null}
                  </div>
                  <p className="text-xs text-ink-45">
                    {k('photoCount', { count: photos.length })}
                    {shared && shared.length ? <span className="font-semibold text-danger"> · {k('sharedPhotos', { count: shared.length })}</span> : null}
                  </p>

                  <dl className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.title')}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">{listing.title || '—'} {sameChip(index, 'title')}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.price')}</dt>
                      <dd className="u-tabular flex flex-wrap items-center gap-1.5 text-ink">
                        {listing.price ? formatPrice(listing.price, listing.purpose, listing.price_period) : '—'} {sameChip(index, 'price')}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.reference')}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5 text-ink">{listing.reference || '—'} {sameChip(index, 'reference')}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.place')}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5 text-ink">
                        {[listing.quartier, listing.commune].filter(Boolean).join(', ') || '—'} {sameChip(index, 'quartier') || sameChip(index, 'commune')}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.beds')}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5 text-ink">{listing.beds ?? '—'} {sameChip(index, 'beds')}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.agent')}</dt>
                      <dd className="flex flex-wrap items-center gap-1.5 text-ink">
                        {listing.agent_name || (listing.agent_id ? `Agent #${listing.agent_id}` : '—')}
                        {listing.agent_phone ? <span className="text-ink-45">+{String(listing.agent_phone).replace(/\D/g, '')}</span> : null}
                        {sameChip(index, 'agent')}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.created')}</dt>
                      <dd className="text-ink">{shortDate(listing.created_at)}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-ink-45">{k('field.description')}</dt>
                      <dd className="max-h-40 overflow-y-auto whitespace-pre-line text-ink-70">{listing.description || '—'}</dd>
                    </div>
                  </dl>

                  <div className="mt-auto flex flex-col gap-2 border-t border-line pt-3">
                    {canModerate && state === 'pending' ? <CompareDecision id={listing.id} /> : null}
                    <div className="flex flex-wrap gap-3 text-sm">
                      <Link href={`/admin/listings/${listing.id}`} className="inline-flex items-center gap-1 font-medium text-blue hover:underline">
                        <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                        {k('open')}
                      </Link>
                      {state === 'live' ? (
                        <a href={`/listings/${listing.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue hover:underline">
                          <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                          {k('public')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
