'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, Search, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildHref } from '@/lib/adminPagination';
import { useT } from '@/lib/i18n/client';

const CONTROL =
  'u-focus-ring u-micro h-9 rounded-lg border border-line bg-surface px-2.5 text-ink disabled:opacity-50';
const DEBOUNCE_MS = 350;

/**
 * Filter bar for a server-paginated /admin table.
 *
 * Every control writes the URL (router.replace, no scroll jump) and the Server
 * Component re-queries one page — the browser never holds more than that page.
 * Typed inputs are debounced so a search is one query per pause, not one per
 * keystroke; selects and dates apply at once. Changing any filter drops the
 * page number (see buildHref).
 *
 * The current values arrive as `params` from the server rather than through
 * useSearchParams(), which would force a Suspense boundary around the whole
 * table (web/CLAUDE.md, "Gotchas").
 *
 * @param {{
 *   params: Record<string, string|undefined>,
 *   search?: {param?: string, placeholder: string},
 *   filters?: Array<
 *     {type: 'select', param: string, label: string, options: Array<{value: string, label: string}>, allLabel?: string}
 *   | {type: 'number', param: string, label: string, placeholder?: string, min?: number, step?: number}
 *   | {type: 'date', param: string, label: string}
 *   >,
 *   resetKeys?: string[],
 *   children?: React.ReactNode,
 * }} props
 */
export default function TableToolbar({ params, search, filters = [], resetKeys, children }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(overrides) {
    startTransition(() => {
      router.replace(buildHref(pathname, params, overrides), { scroll: false });
    });
  }

  const keys = resetKeys || [search?.param || 'q', ...filters.map((f) => f.param)];
  const active = keys.some((key) => params[key] !== undefined && params[key] !== '');

  return (
    <div className="flex flex-wrap items-end gap-2" role="search">
      {search ? (
        <DebouncedInput
          param={search.param || 'q'}
          value={params[search.param || 'q'] || ''}
          placeholder={search.placeholder}
          onCommit={apply}
          icon
          className="min-w-[14rem] flex-1 sm:max-w-[22rem]"
        />
      ) : null}

      {filters.map((filter) => {
        const value = params[filter.param] || '';
        if (filter.type === 'select') {
          return (
            <label key={filter.param} className="flex flex-col gap-1">
              <span className="u-eyebrow text-ink-45">{filter.label}</span>
              <select
                value={value}
                onChange={(event) => apply({ [filter.param]: event.target.value })}
                className={`${CONTROL} pr-7`}
              >
                <option value="">{filter.allLabel || t('admin.table.all')}</option>
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          );
        }
        if (filter.type === 'date') {
          return (
            <label key={filter.param} className="flex flex-col gap-1">
              <span className="u-eyebrow text-ink-45">{filter.label}</span>
              <input
                type="date"
                value={value}
                onChange={(event) => apply({ [filter.param]: event.target.value })}
                className={CONTROL}
              />
            </label>
          );
        }
        return (
          <label key={filter.param} className="flex flex-col gap-1">
            <span className="u-eyebrow text-ink-45">{filter.label}</span>
            <DebouncedInput
              param={filter.param}
              value={value}
              type="number"
              min={filter.min}
              step={filter.step}
              placeholder={filter.placeholder}
              onCommit={apply}
              className="w-28"
            />
          </label>
        );
      })}

      {children}

      <div className="flex h-9 items-center gap-2">
        {active ? (
          <button
            type="button"
            onClick={() => apply(Object.fromEntries(keys.map((key) => [key, ''])))}
            className="u-press u-micro-strong inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-ink-70 hover:bg-canvas-alt hover:text-ink"
          >
            <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            {t('admin.table.clearFilters')}
          </button>
        ) : null}
        {pending ? (
          <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin text-ink-45" aria-label={t('admin.table.loading')} />
        ) : null}
      </div>
    </div>
  );
}

function DebouncedInput({ param, value, onCommit, icon = false, className = '', ...inputProps }) {
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);
  const timer = useRef(null);

  // The URL changed from outside (back button, "clear filters"): adopt it.
  // Adjusting state during render is React's own pattern for derived resets.
  if (value !== committed) {
    setCommitted(value);
    setDraft(value);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function change(next) {
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next.trim() === String(value).trim()) return;
      setCommitted(next.trim());
      onCommit({ [param]: next.trim() });
    }, DEBOUNCE_MS);
  }

  return (
    <div className={`relative ${className}`}>
      {icon ? (
        <Search strokeWidth={ICON_STROKE_WIDTH} className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-35" />
      ) : null}
      <input
        {...inputProps}
        type={inputProps.type || 'search'}
        value={draft}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            clearTimeout(timer.current);
            setCommitted(draft.trim());
            onCommit({ [param]: draft.trim() });
          }
        }}
        className={`${CONTROL} w-full ${icon ? 'pl-8' : ''}`}
      />
    </div>
  );
}
