'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * Saved homes that are no longer online (2026-11-08): which ones, why
 * (let/sold or withdrawn), a link to homes like it, and a way to clear them.
 * lib/favoriteUnavailable.js decides what is shown — never a price, photo or
 * agent of a listing that is off the site.
 */
export default function UnavailableFavorites({ items, deletedIds = [], removeAction }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [hidden, setHidden] = useState(() => new Set());
  const [, startTransition] = useTransition();
  const visible = items.filter((item) => !hidden.has(item.id));
  const deleted = deletedIds.filter((id) => !hidden.has(id));
  if (visible.length === 0 && deleted.length === 0) return null;

  // Hides at once; anything that fails to remove comes back, with a toast.
  function remove(ids) {
    setHidden((prev) => new Set([...prev, ...ids]));
    startTransition(async () => {
      const failed = [];
      for (const id of ids) {
        let result;
        try {
          result = await removeAction(String(id));
        } catch {
          result = { ok: false };
        }
        if (!result?.ok) failed.push(id);
      }
      if (failed.length > 0) {
        setHidden((prev) => {
          const next = new Set(prev);
          for (const id of failed) next.delete(id);
          return next;
        });
        showToast({ type: 'error', message: t('account.favorites.offline.removeFailed') });
        return;
      }
      router.refresh();
    });
  }

  return (
    <section id="plus-en-ligne" aria-labelledby="plus-en-ligne-title" className="mt-8 scroll-mt-24">
      <h2 id="plus-en-ligne-title" className="u-title-card text-ink">
        {t('account.favorites.offline.title')} <span className="text-ink-45">({visible.length + deleted.length})</span>
      </h2>
      <p className="mt-1 text-[0.8125rem] text-ink-45">{t('account.favorites.offline.lead')}</p>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card bg-surface shadow-[var(--hairline)]">
        {visible.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9375rem] font-semibold text-ink">{item.title || t('account.favorites.offline.untitled')}</p>
              <p className="text-[0.78125rem] text-ink-45">{t(`account.favorites.offline.reason.${item.reason}`)}</p>
            </div>
            <div className="flex flex-none items-center gap-2">
              <Link
                href={item.similarHref}
                className="u-press inline-flex min-h-10 items-center gap-1.5 rounded-full bg-blue-tint px-3.5 text-[0.8125rem] font-bold text-blue-deep"
              >
                <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                {t('account.favorites.offline.similar')}
              </Link>
              <button
                type="button"
                onClick={() => remove([item.id])}
                aria-label={t('account.favorites.offline.remove')}
                className="u-press grid h-10 w-10 place-items-center rounded-full text-ink-45 hover:bg-canvas-alt hover:text-ink"
              >
                <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
        {deleted.length > 0 ? (
          <li className="flex items-center gap-2 px-4 py-3">
            <p className="min-w-0 flex-1 text-[0.8125rem] text-ink-45">{t('account.favorites.offline.deleted', { count: deleted.length })}</p>
            <button
              type="button"
              onClick={() => remove(deleted)}
              className="u-press inline-flex min-h-10 flex-none items-center rounded-full px-3 text-[0.8125rem] font-bold text-ink-70 hover:bg-canvas-alt"
            >
              {t('account.favorites.offline.clear')}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
