'use client';

import { useMemo, useState } from 'react';
import { Check, ImageIcon, Search } from 'lucide-react';
import SafeImage from '@/components/SafeImage';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** At most this many listings in one send, so a tap never floods a customer's thread. */
const MAX_SHARE = 5;

/**
 * "Partager un bien": the agent picks some of their own public listings
 * (lib/chat.js listShareableListings — the same rule the server applies to a
 * `listing` message) and each arrives in the conversation as a listing card.
 */
export default function ShareListingsDialog({ open, onOpenChange, listings, onShare, t }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter((card) => [card.category, card.place, card.priceLabel, String(card.id)].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [listings, query]);

  function toggle(id) {
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_SHARE ? current : [...current, id]));
  }

  function close(next) {
    onOpenChange(next);
    if (!next) {
      setPicked([]);
      setQuery('');
    }
  }

  function send() {
    const cards = picked.map((id) => listings.find((card) => card.id === id)).filter(Boolean);
    if (cards.length) onShare(cards);
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(40rem,90dvh)] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t('chat.agent.shareTitle')}</DialogTitle>
          <DialogDescription>{t('chat.agent.shareLead', { max: MAX_SHARE })}</DialogDescription>
        </DialogHeader>

        {listings.length === 0 ? (
          <p className="rounded-lg bg-canvas-alt px-4 py-6 text-center text-[0.9375rem] text-ink-70">{t('chat.agent.shareNone')}</p>
        ) : (
          <>
            <label className="flex h-11 items-center gap-2.5 rounded-lg border border-line px-3.5 text-ink-45 focus-within:border-blue">
              <Search strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] flex-none" aria-hidden="true" />
              <span className="sr-only">{t('chat.agent.shareSearch')}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('chat.agent.shareSearch')}
                className="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none"
              />
            </label>
            <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
              {visible.map((card) => {
                const on = picked.includes(card.id);
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(card.id)}
                      className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-canvas-alt', on && 'bg-blue-tint hover:bg-blue-tint')}
                    >
                      <span className="relative h-14 w-14 flex-none overflow-hidden rounded-[10px] bg-canvas-alt">
                        {card.image ? (
                          <SafeImage src={card.image} alt="" fill sizes="56px" className="object-cover" />
                        ) : (
                          <span className="grid h-full w-full place-items-center text-ink-35">
                            <ImageIcon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[0.9375rem] font-semibold text-ink">{card.category}</span>
                        {card.place ? <span className="truncate text-[0.8125rem] text-ink-45">{card.place}</span> : null}
                        <span className="u-tabular text-[0.9375rem] font-bold tracking-[-0.02em] text-ink">{card.priceLabel}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn('grid h-6 w-6 flex-none place-items-center rounded-md border-[1.5px]', on ? 'border-blue bg-blue text-white' : 'border-ink-25 bg-surface')}
                      >
                        {on ? <Check strokeWidth={3} className="h-4 w-4" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <DialogFooter>
          <button type="button" onClick={() => close(false)} className="u-press u-btn-secondary rounded-lg px-4 py-2.5 text-sm font-semibold text-ink">
            {t('chat.report.cancel')}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={picked.length === 0}
            className="u-press rounded-lg bg-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep disabled:bg-line disabled:text-ink-35"
          >
            {t('chat.agent.shareSend', { count: picked.length })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
