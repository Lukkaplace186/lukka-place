/**
 * The small pieces the four direct-to-agent admin pages share (/admin/viewings,
 * /admin/market-data, /admin/benchmarks, /admin/telemetry). Server-safe: no
 * hooks, no translator — callers pass already-translated strings.
 */

export const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-35';
export const TH_RIGHT = `${TH} text-right`;
export const TD = 'u-micro px-4 py-2.5 align-top text-ink-70';
export const TD_RIGHT = `${TD} u-tabular text-right`;

export function Stat({ label, value, hint }) {
  return (
    <div className="u-card rounded-card bg-surface p-4">
      <div className="u-eyebrow text-ink-45">{label}</div>
      <div className="u-stat mt-1.5 text-ink">{value}</div>
      {hint ? <div className="u-micro mt-1 text-ink-45">{hint}</div> : null}
    </div>
  );
}

/**
 * `aside` rides beside the title (an InfoTip, a link); `emptyGraphic` swaps the
 * plain empty sentence for a ghost chart above it, for panels that will one day
 * hold a chart or a table of figures.
 */
export function Panel({ title, note, children, isEmpty, emptyText, aside = null, emptyGraphic = null }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="u-title-card text-ink">{title}</h2>
          {aside}
        </div>
        {note ? <p className="u-micro mt-0.5 text-ink-45">{note}</p> : null}
      </div>
      {isEmpty ? (
        <div className="rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center">
          {emptyGraphic || <p className="u-micro text-ink-45">{emptyText}</p>}
        </div>
      ) : (
        <div className="u-card overflow-x-auto rounded-card bg-surface">{children}</div>
      )}
    </section>
  );
}

const CHIP_TONES = {
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  blue: 'bg-blue-tint text-blue-deep',
  neutral: 'bg-canvas-deep text-ink-45',
};

/** A status chip: tone carries state, the text always names it too. */
export function Chip({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${CHIP_TONES[tone] || CHIP_TONES.neutral}`}>
      {children}
    </span>
  );
}

export const STATUS_TONE = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  RESCHEDULED: 'blue',
  DECLINED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export const ROUTING_TONE = { DIRECT_WA: 'success', CENTRAL_FALLBACK: 'blue' };

export function ErrorNote({ children }) {
  return (
    <p className="u-micro rounded-card border border-danger/30 bg-danger-tint px-4 py-3 text-danger" role="alert">
      {children}
    </p>
  );
}

/**
 * A timestamp in Kinshasa wall-clock time. Accepts SQLite's zone-less UTC
 * ("2026-09-13 10:04:00"), a full ISO string, or a Date.
 */
export function formatKinshasa(value) {
  if (!value) return '—';
  let date;
  if (value instanceof Date) date = value;
  else {
    const text = String(value);
    date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  }
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa', dateStyle: 'medium', timeStyle: 'short' });
}

/** "45 s", "14 min", "2 h 05" — a response time at the resolution it matters. */
export function formatLatency(seconds) {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function formatPct(value) {
  if (value == null) return '—';
  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('fr-FR')} %`;
}

export function formatRate(value) {
  if (value == null) return '—';
  return `${(Math.round(Number(value) * 10) / 10).toLocaleString('fr-FR')} %`;
}

export function money(value) {
  if (value == null) return '—';
  return `$${Math.round(Number(value)).toLocaleString('fr-FR')}`;
}
