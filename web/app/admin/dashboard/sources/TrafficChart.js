import { frNumber } from '@/lib/format';
import { CHANNEL_COLORS, bucketKeys } from '@/lib/trafficChannels';

function label(key, bucket, locale) {
  const date = new Date(`${key}:00Z`);
  const tag = locale === 'en' ? 'en-GB' : 'fr-FR';
  if (bucket === 'hour') return `${String(date.getUTCHours()).padStart(2, '0')} h`;
  if (bucket === 'week') return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  return new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * Visitors per hour / day / week, one stacked bar per bucket, one colour per
 * channel (the biggest ones; the rest is grey). Plain HTML, server-rendered:
 * the hover detail is each segment's title.
 */
export default function TrafficChart({ rows, bucket, days, shown, folded, locale, labels, emptyLabel }) {
  const keys = bucketKeys({ bucket, days, rows });
  if (!rows.length || !keys.length) {
    return <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">{emptyLabel}</div>;
  }
  const shownSet = new Set(shown);
  const byKey = new Map(keys.map((key) => [key, {}]));
  for (const row of rows) {
    const slot = byKey.get(row.bucket);
    if (!slot) continue;
    const series = shownSet.has(row.channel) ? row.channel : 'rest';
    slot[series] = (slot[series] || 0) + row.visitors;
  }
  const order = [...shown, ...(folded ? ['rest'] : [])];
  const totals = keys.map((key) => order.reduce((sum, s) => sum + (byKey.get(key)[s] || 0), 0));
  const max = Math.max(1, ...totals);
  const every = Math.max(1, Math.ceil(keys.length / 12));

  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-70">
        {order.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: CHANNEL_COLORS[s] || '#CBD5E1' }} />
            {labels[s]}
          </span>
        ))}
      </div>
      <div className="relative">
        <span className="u-tabular absolute left-0 top-0 text-[11px] text-ink-45">{frNumber(max)}</span>
        <div className="flex h-56 items-end gap-[2px] border-b border-line pt-5">
          {keys.map((key, i) => {
            const slot = byKey.get(key);
            const title = [`${label(key, bucket, locale)} — ${frNumber(totals[i])}`, ...order.filter((s) => slot[s]).map((s) => `${labels[s]} : ${frNumber(slot[s])}`)].join('\n');
            return (
              <div key={key} className="flex h-full min-w-0 flex-1 flex-col-reverse" title={title}>
                {order.map((s) => (slot[s] ? (
                  <div key={s} style={{ height: `${(slot[s] / max) * 100}%`, backgroundColor: CHANNEL_COLORS[s] || '#CBD5E1' }} className="w-full first:rounded-b-none last:rounded-t-[2px]" />
                ) : null))}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-[2px]">
          {keys.map((key, i) => (
            <span key={key} className="min-w-0 flex-1 truncate text-center text-[11px] text-ink-45">
              {i % every === 0 || i === keys.length - 1 ? label(key, bucket, locale) : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
