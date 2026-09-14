'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, FileText, Loader2, MessageCircle, Search, User, Users } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

const GROUP_ICONS = { listings: FileText, agents: User, agencies: Building2, customers: Users, conversations: MessageCircle };
const GROUP_LABEL_KEYS = {
  listings: 'admin.search.groupListings',
  agents: 'admin.search.groupAgents',
  agencies: 'admin.search.groupAgencies',
  customers: 'admin.search.groupCustomers',
  conversations: 'admin.search.groupConversations',
};

/**
 * One box for the whole console: paste a phone number, a listing id or
 * reference, a name or an agency and jump straight to it. Ctrl/⌘+K focuses it
 * from anywhere. Results come from /admin/api/search, which only returns the
 * groups the signed-in role may open.
 */
export default function GlobalSearch() {
  const t = useT();
  const router = useRouter();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [highlight, setHighlight] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    function onKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    function onClick(event) {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return undefined;
    const id = ++seq.current;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/admin/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const body = res.ok ? await res.json() : { groups: [] };
        if (id === seq.current) {
          setGroups(body.groups || []);
          setHighlight(0);
        }
      } catch {
        if (id === seq.current) setGroups([]);
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const flat = query.trim().length >= 2 ? groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.key }))) : [];

  function go(item) {
    setOpen(false);
    setQuery('');
    setGroups([]);
    router.push(item.href);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search strokeWidth={ICON_STROKE_WIDTH} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-35" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((h) => Math.min(h + 1, flat.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (event.key === 'Enter' && flat[highlight]) {
            event.preventDefault();
            go(flat[highlight]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={t('admin.search.placeholder')}
        aria-label={t('admin.search.placeholder')}
        className="u-focus-ring u-micro h-10 w-full rounded-lg border border-line bg-canvas-alt pl-9 pr-14 text-ink"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface px-1.5 text-[0.625rem] font-semibold text-ink-45 sm:inline">
        Ctrl K
      </kbd>

      {open && query.trim().length >= 2 ? (
        <div className="u-lift absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-auto rounded-card border border-line bg-surface py-1" role="listbox">
          {loading && flat.length === 0 ? (
            <div className="u-micro flex items-center gap-2 px-3 py-3 text-ink-45">
              <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 animate-spin" />
              {t('admin.table.loading')}
            </div>
          ) : null}
          {!loading && flat.length === 0 ? <div className="u-micro px-3 py-3 text-ink-45">{t('admin.search.noResults')}</div> : null}
          {groups.map((group) => {
            const Icon = GROUP_ICONS[group.key] || Search;
            return group.items.length ? (
              <div key={group.key} className="py-1">
                <div className="u-eyebrow px-3 py-1 text-ink-35">{t(GROUP_LABEL_KEYS[group.key])}</div>
                {group.items.map((item) => {
                  const index = flat.findIndex((entry) => entry.group === group.key && entry.href === item.href);
                  return (
                    <button
                      key={item.href}
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => go(item)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left ${index === highlight ? 'bg-canvas-alt' : ''}`}
                    >
                      <Icon strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-ink-35" />
                      <span className="min-w-0">
                        <span className="u-micro-strong block truncate text-ink">{item.title}</span>
                        {item.subtitle ? <span className="u-micro block truncate text-ink-45">{item.subtitle}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null;
          })}
        </div>
      ) : null}
    </div>
  );
}
