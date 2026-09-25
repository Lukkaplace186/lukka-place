'use client';

import { useMemo, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { PASTE_COLUMNS, parsePastedRows } from '@/lib/projectPaste';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * "Coller depuis Excel": paste cells copied from a spreadsheet, see every row
 * as it will be saved — or in red with the reason it will not be — then
 * import. The same parser runs again on the server (the preview is never
 * trusted), so what is previewed is what is saved.
 *
 * `labels.columns` names each column (resolved on the server), `labels.errors`
 * maps an error key to its sentence.
 */
export default function PasteImport({ action, kind, context = {}, labels, hidden = {} }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? parsePastedRows(text, kind, context) : null), [text, kind, context]);
  const columns = PASTE_COLUMNS[kind];
  const valid = parsed ? parsed.rows.filter((r) => r.value).length : 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink">
        <ClipboardPaste strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {labels.open}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-card border border-line bg-canvas-alt p-4">
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value ?? ''} />)}
      <p className="text-[0.8125rem] text-ink-70">{labels.intro}</p>
      <p className="u-micro-strong text-ink">{columns.map((c) => labels.columns[c]).join(' · ')}</p>
      <textarea
        name="text"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={labels.placeholder}
        className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-ink"
      />
      {parsed ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[28rem] text-xs">
            <thead className="bg-canvas-alt text-left text-ink-45">
              <tr>
                <th className="px-2 py-1.5 font-semibold">#</th>
                {columns.map((c) => <th key={c} className="px-2 py-1.5 font-semibold">{labels.columns[c]}</th>)}
                <th className="px-2 py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {parsed.rows.map((row) => (
                <tr key={row.line} className={`border-t border-line ${row.errorKey ? 'bg-danger-tint' : ''}`}>
                  <td className="px-2 py-1.5 text-ink-45">{row.line}</td>
                  {columns.map((c, i) => (
                    <td key={c} className="px-2 py-1.5 text-ink">
                      {row.value ? String(row.value[c] ?? '—') : (row.cells[i] || '—')}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 font-semibold text-danger">{row.errorKey ? (labels.errors[row.errorKey] || labels.errors.generic) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {parsed?.skippedHeader ? <p className="text-[0.75rem] text-ink-45">{labels.headerSkipped}</p> : null}
      {parsed?.truncated ? <p className="text-[0.75rem] font-semibold text-danger">{labels.truncated}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!valid} className="u-btn-primary inline-flex min-h-11 items-center rounded-full bg-blue px-5 text-sm font-semibold text-white disabled:opacity-40">
          {labels.submit.replace('{count}', String(valid))}
        </button>
        <button type="button" onClick={() => { setOpen(false); setText(''); }} className="text-sm font-semibold text-ink-70 hover:text-ink">
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}
