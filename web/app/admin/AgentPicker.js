'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { BadgeCheck, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { searchAgentsAction } from './agentSearchActions';

/**
 * Searchable agent selector — replaces every `<select>` that listed ALL agents.
 *
 * At 30k agents a full option list is a multi-megabyte page per table row and
 * unusable anyway. This asks the server for at most 20 matches per pause in
 * typing. Opened with an empty query it shows the best suggestions: that
 * commune's specialists, then its coverage agents (`commune` prop), which is
 * what the old "Couvre {commune}" optgroup did.
 *
 * Works two ways: inside a plain `<form action>` via `name` (renders a hidden
 * input), or imperatively via `onSelect`.
 */
export default function AgentPicker({
  name,
  onSelect,
  defaultAgent = null,
  commune = null,
  routableOnly = false,
  activeOnly = false,
  excludeId = null,
  allowClear = false,
  placeholder,
  disabled = false,
  className = '',
}) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(defaultAgent);
  const [highlight, setHighlight] = useState(0);
  const [loading, startLoading] = useTransition();
  const timer = useRef(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      startLoading(async () => {
        const result = await searchAgentsAction({ q: query, commune, routableOnly, activeOnly, excludeId });
        if (seq !== requestSeq.current) return; // a newer query already answered
        setResults(result.agents || []);
        setError(result.ok ? null : result.error);
        setHighlight(0);
      });
    }, query ? 250 : 0);
    return () => clearTimeout(timer.current);
  }, [open, query, commune, routableOnly, activeOnly, excludeId]);

  function choose(agent) {
    setSelected(agent);
    setOpen(false);
    setQuery('');
    onSelect?.(agent);
  }

  const options = allowClear ? [{ id: null, name: t('admin.picker.none') }, ...results] : results;

  return (
    <div className={className}>
      {name ? <input type="hidden" name={name} value={selected?.id ?? ''} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="u-focus-ring u-micro flex h-9 w-full min-w-[12rem] items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 text-left text-ink disabled:opacity-50"
          >
            <span className={`truncate ${selected ? 'text-ink' : 'text-ink-45'}`}>
              {selected?.name || placeholder || t('admin.picker.placeholder')}
            </span>
            <ChevronsUpDown strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] p-0">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlight((h) => Math.min(h + 1, options.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (event.key === 'Enter' && options[highlight]) {
                  event.preventDefault();
                  const option = options[highlight];
                  choose(option.id === null ? null : option);
                }
              }}
              placeholder={t('admin.picker.searchPlaceholder')}
              aria-controls={listId}
              className="u-focus-ring u-micro h-9 w-full rounded-md border border-line bg-surface px-2.5 text-ink"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-72 overflow-auto py-1">
            {loading && results.length === 0 ? (
              <li className="u-micro flex items-center gap-2 px-3 py-2 text-ink-45">
                <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" />
                {t('admin.table.loading')}
              </li>
            ) : null}
            {error ? <li className="u-micro px-3 py-2 text-danger">{error}</li> : null}
            {!loading && !error && results.length === 0 ? (
              <li className="u-micro px-3 py-2 text-ink-45">{t('admin.picker.noResults')}</li>
            ) : null}
            {options.map((agent, index) => (
              <li
                key={agent.id ?? 'none'}
                role="option"
                aria-selected={selected?.id === agent.id}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(agent.id === null ? null : agent)}
                className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${index === highlight ? 'bg-canvas-alt' : ''}`}
              >
                <Check
                  strokeWidth={ICON_STROKE_WIDTH}
                  className={`mt-0.5 h-4 w-4 shrink-0 ${selected?.id === agent.id ? 'text-blue-deep' : 'text-transparent'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="u-micro-strong flex items-center gap-1 text-ink">
                    <span className="truncate">{agent.name}</span>
                    {agent.verified ? (
                      <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0 text-success" aria-label={t('admin.picker.verified')} />
                    ) : null}
                  </span>
                  {agent.id !== null ? (
                    <span className="u-micro flex flex-wrap gap-x-2 text-ink-45">
                      <span className="u-tabular">{agent.phone ? `+${agent.phone}` : `#${agent.id}`}</span>
                      {agent.coversPrimary ? <span className="text-blue-deep">{t('admin.picker.specialist', { commune })}</span> : null}
                      {!agent.coversPrimary && agent.coversServiced ? <span className="text-blue-deep">{t('admin.picker.covers', { commune })}</span> : null}
                      {agent.active === false ? <span className="text-warning">{t('admin.picker.inactive')}</span> : null}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}
