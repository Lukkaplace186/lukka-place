'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { isNetworkError } from '@/lib/networkError';
import { confirmListingAvailableAction, confirmListingPriceChangedAction } from '@/app/compte/agent/availabilityActions';
import MarkListingSoldDialog from './MarkListingSoldDialog';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

// How many due listings the card shows before "Afficher les N autres".
const VISIBLE_ROWS = 3;

const BUTTON =
  'u-press inline-flex h-10 min-w-0 items-center justify-center rounded-lg px-2 text-center text-[0.8125rem] font-bold leading-tight disabled:opacity-60';

/**
 * "Toujours disponible ?" — the weekly one-tap check (lib/listingAvailability.js).
 *
 * Three answers per listing, each reusing the path that already owns it:
 *   - Toujours disponible → confirmListingAvailableAction (stamps the date)
 *   - Loué / vendu        → MarkListingSoldDialog, i.e. markListingSoldAction,
 *                           the only way to 'closed' (real price + date)
 *   - Prix modifié        → updateListingPriceAction, then the stamp
 *
 * `items` is getAvailabilityPrompts()'s output, already only the listings
 * that are due; the card renders nothing when there are none. `single` is
 * the one-listing variant on that listing's own editor page (no titles, no
 * edit link — the agent is already there).
 *
 * An answered row disappears at once and router.refresh() brings the server's
 * list in behind it; a failed answer brings it back with a toast.
 */
export default function AgentAvailabilityPrompt({ items, single = false }) {
  const t = useT();
  const [answered, setAnswered] = useState(() => new Set());
  const [expanded, setExpanded] = useState(false);

  const pendingItems = (items || []).filter((item) => !answered.has(item.id));
  if (pendingItems.length === 0) return null;

  const visible = single || expanded ? pendingItems : pendingItems.slice(0, VISIBLE_ROWS);
  const hiddenCount = pendingItems.length - visible.length;

  function markAnswered(id, done) {
    setAnswered((prev) => {
      const next = new Set(prev);
      if (done) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <section
      aria-labelledby="availability-prompt-title"
      className="rounded-card border border-warning/40 bg-warning-tint p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <CalendarCheck strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 flex-none text-warning" aria-hidden="true" />
        <div className="min-w-0">
          <h2 id="availability-prompt-title" className="u-title-card text-ink">
            {t('agent.availability.title')}
          </h2>
          <p className="u-micro mt-0.5 text-ink-70">
            {single ? t('agent.availability.singleSubtitle') : t('agent.availability.subtitle', { count: pendingItems.length })}
          </p>
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-2.5">
        {visible.map((item) => (
          <AvailabilityRow key={item.id} item={item} single={single} onAnswered={markAnswered} />
        ))}
      </ul>

      {!single && (hiddenCount > 0 || expanded) && pendingItems.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="u-press mt-2 inline-flex h-10 items-center rounded-lg px-2 text-[0.8125rem] font-bold text-blue-deep hover:underline"
        >
          {expanded ? t('agent.availability.showLess') : t('agent.availability.showMore', { count: hiddenCount })}
        </button>
      ) : null}
    </section>
  );
}

function AvailabilityRow({ item, single, onAnswered }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [priceOpen, setPriceOpen] = useState(false);

  const title = item.title || t('agent.availability.untitled', { id: item.id });
  const meta = item.lastConfirmedAt
    ? t('agent.availability.confirmedAgo', { count: item.daysSince })
    : t('agent.availability.neverConfirmed', { count: item.daysSince });
  const soldLabel = item.purpose === 'rent'
    ? t('agent.availability.actions.let')
    : item.purpose === 'sale'
      ? t('agent.availability.actions.sold')
      : t('agent.availability.actions.soldOrLet');

  function failed(err) {
    onAnswered(item.id, false);
    showToast({
      type: 'error',
      message: isNetworkError(err) ? t('agent.availability.errors.network') : t('agent.availability.errors.generic'),
    });
  }

  function handleAvailable() {
    startTransition(async () => {
      onAnswered(item.id, true);
      try {
        const result = await confirmListingAvailableAction(item.id);
        if (!result?.ok) {
          onAnswered(item.id, false);
          showToast({ type: 'error', message: result?.error || t('agent.availability.errors.generic') });
          return;
        }
        showToast({ type: 'success', message: t('agent.availability.toast.confirmed', { title }) });
        router.refresh();
      } catch (err) {
        failed(err);
      }
    });
  }

  function handlePrice(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        const result = await confirmListingPriceChangedAction(item.id, formData);
        if (!result?.ok) {
          showToast({ type: 'error', message: result?.error || t('agent.availability.errors.generic') });
          return;
        }
        onAnswered(item.id, true);
        showToast({
          // Toast has two tones; the price did save either way.
          type: 'success',
          message: result.confirmed
            ? t('agent.availability.toast.priceConfirmed')
            : t('agent.availability.toast.priceSavedOnly'),
        });
        router.refresh();
      } catch (err) {
        failed(err);
      }
    });
  }

  const inputId = `availability-price-${item.id}`;

  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      {!single ? (
        <div className="min-w-0">
          <Link
            href={`/compte/agent/biens/${item.id}/edit`}
            className="u-micro-strong block truncate text-ink hover:underline"
          >
            {title}
          </Link>
          <div className="u-micro text-ink-45">{meta}</div>
        </div>
      ) : (
        <div className="u-micro text-ink-45">{meta}</div>
      )}

      <div className="mt-2.5 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={handleAvailable}
          disabled={pending}
          className={`${BUTTON} u-btn-primary bg-blue text-white hover:bg-blue-deep`}
        >
          {t('agent.availability.actions.available')}
        </button>
        <MarkListingSoldDialog
          propertyId={item.id}
          purpose={item.purpose}
          title={title}
          renderTrigger={(open) => (
            <button
              type="button"
              onClick={open}
              disabled={pending}
              className={`${BUTTON} u-btn-secondary text-ink`}
            >
              {soldLabel}
            </button>
          )}
        />
        <button
          type="button"
          onClick={() => setPriceOpen((v) => !v)}
          disabled={pending}
          aria-expanded={priceOpen}
          aria-controls={`${inputId}-form`}
          className={`${BUTTON} u-btn-secondary text-ink`}
        >
          {t('agent.availability.actions.priceChanged')}
        </button>
      </div>

      {priceOpen ? (
        <form id={`${inputId}-form`} onSubmit={handlePrice} className="mt-2.5 flex flex-wrap items-end gap-2">
          <input type="hidden" name="currency" value={item.currency} />
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="u-micro-strong mb-1 block text-ink-70">
              {t('agent.availability.price.label', { currency: item.currency === 'CDF' ? 'FC' : '$' })}
            </label>
            <input
              id={inputId}
              name="price"
              type="number"
              inputMode="decimal"
              min="1"
              step="any"
              required
              autoFocus
              defaultValue={item.authoredPrice ?? ''}
              className="u-focus-ring u-tabular h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className={`${BUTTON} u-btn-primary bg-blue px-4 text-white hover:bg-blue-deep`}
          >
            {pending ? t('common.actions.saving') : t('agent.availability.price.save')}
          </button>
        </form>
      ) : null}
    </li>
  );
}
