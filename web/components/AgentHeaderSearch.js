'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const DEBOUNCE_MS = 350;

/**
 * The dashboard header's search box.
 *
 * - **Filters as you type** when it searches the page it sits on: a pause of
 *   DEBOUNCE_MS replaces the URL's `?q=` (router.replace, no scroll, no new
 *   history entry per letter). The page re-renders filtered on the server, in
 *   a transition, so the list stays on screen until the new one arrives.
 * - When it searches ANOTHER page (the overview's box searches Mes biens), it
 *   waits for Enter — jumping pages on the first letter would be a surprise.
 * - It is still a real GET form: Enter, and a phone with JavaScript not yet
 *   loaded, submit it exactly as before.
 * - **On a phone it is an icon** until tapped (or until a search is active),
 *   and then opens over the header row, so the header stays ONE row: the old
 *   layout spent ~110px of a phone screen on title + search.
 */
export default function AgentHeaderSearch({ action, defaultValue = '', placeholder, hiddenFields }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(Boolean(defaultValue));
  const [pending, startTransition] = useTransition();
  const timer = useRef(null);
  const inputRef = useRef(null);
  const live = pathname === action;

  // A chip or tab click keeps `q` in the URL; a link that drops it resets the
  // box. Not while the agent is typing: the page answering an earlier pause
  // would otherwise overwrite the letters typed since.
  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === inputRef.current) return;
    setValue(defaultValue);
  }, [defaultValue]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function hrefFor(q) {
    const params = new URLSearchParams();
    for (const [name, v] of Object.entries(hiddenFields || {})) if (v) params.set(name, v);
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString();
    return qs ? `${action}?${qs}` : action;
  }

  function onChange(event) {
    const next = event.target.value;
    setValue(next);
    if (!live) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(() => router.replace(hrefFor(next), { scroll: false }));
    }, DEBOUNCE_MS);
  }

  function clear() {
    clearTimeout(timer.current);
    setValue('');
    setOpen(false);
    if (live && defaultValue) startTransition(() => router.replace(hrefFor(''), { scroll: false }));
  }

  function openOnPhone() {
    setOpen(true);
    // After the input is shown.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <>
      <button
        type="button"
        onClick={openOnPhone}
        aria-label={placeholder}
        className={`u-press relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-ink-70 hover:bg-canvas-alt hover:text-ink sm:hidden ${
          open ? 'invisible' : ''
        }`}
      >
        <Search strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
      </button>

      <form
        method="get"
        action={action}
        role="search"
        onSubmit={(event) => {
          if (!live) return;
          event.preventDefault();
          clearTimeout(timer.current);
          startTransition(() => router.replace(hrefFor(value), { scroll: false }));
        }}
        className={`${
          open ? 'absolute inset-x-3 top-1/2 z-10 flex -translate-y-1/2' : 'hidden'
        } items-center bg-surface sm:relative sm:inset-auto sm:z-auto sm:flex sm:w-[16rem] sm:translate-y-0`}
      >
        {Object.entries(hiddenFields || {}).map(([name, v]) =>
          v ? <input key={name} type="hidden" name={name} value={v} /> : null,
        )}
        <Search
          strokeWidth={ICON_STROKE_WIDTH}
          className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${pending ? 'animate-pulse text-blue' : 'text-ink-35'}`}
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          // Global "/" shortcut (AgentKeyboardShortcuts.js) focuses by this id —
          // every page that renders a search box shares it, since only one can
          // ever be on screen at a time.
          id="agent-page-search"
          type="search"
          name="q"
          value={value}
          onChange={onChange}
          onKeyDown={(event) => {
            if (event.key === 'Escape') clear();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className="u-focus-ring h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-10 text-sm text-ink placeholder:text-ink-35 sm:pr-3"
        />
        <button
          type="button"
          onClick={clear}
          aria-label={t('common.actions.close')}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-ink-45 hover:text-ink sm:hidden"
        >
          <X strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </button>
      </form>
    </>
  );
}
