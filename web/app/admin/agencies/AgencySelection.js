'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import { BulkDeleteButton, useBulkDelete } from '../BulkDelete';

/**
 * Row selection for the server-rendered /admin/agencies table: the page stays
 * a Server Component, and only the checkboxes and the bulk bar are client
 * islands sharing this context. Delete is the only bulk action here; an
 * agency's roster keeps Activer / Suspendre on /admin/agencies/[id].
 */
const SelectionContext = createContext(null);

export function AgencySelectionProvider({ pageIds, children }) {
  const [selected, setSelected] = useState(() => new Set());
  const value = useMemo(() => ({ pageIds, selected, setSelected }), [pageIds, selected]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function AgencySelectAll() {
  const t = useT();
  const { pageIds, selected, setSelected } = useContext(SelectionContext);
  const all = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      aria-label={t('admin.softDelete.selectPage')}
      checked={all}
      onChange={() => setSelected(all ? new Set() : new Set(pageIds))}
      className="h-4 w-4 accent-blue"
    />
  );
}

export function AgencySelectBox({ id, name }) {
  const t = useT();
  const { selected, setSelected } = useContext(SelectionContext);
  return (
    <input
      type="checkbox"
      aria-label={t('admin.softDelete.selectRow', { name })}
      checked={selected.has(id)}
      onChange={() =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })
      }
      className="h-4 w-4 accent-blue"
    />
  );
}

export function AgencyBulkBar() {
  const t = useT();
  const { selected, setSelected } = useContext(SelectionContext);
  const bulkDelete = useBulkDelete('agency', { onDeleted: () => setSelected(new Set()) });
  return (
    <>
      {bulkDelete.dialog}
      {selected.size > 0 ? (
        <div className="u-card sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-card bg-ink px-4 py-2 text-white">
          <span className="u-micro-strong">{t('admin.agents.selectedCount', { count: selected.size })}</span>
          <BulkDeleteButton disabled={bulkDelete.pending} onClick={() => bulkDelete.request(selected)} />
          <button type="button" onClick={() => setSelected(new Set())} className="u-micro ml-auto text-white/75 hover:text-white">
            {t('admin.agents.clearSelection')}
          </button>
        </div>
      ) : null}
    </>
  );
}
