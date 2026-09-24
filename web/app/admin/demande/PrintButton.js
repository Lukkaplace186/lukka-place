'use client';

/** window.print() — the console chrome is print:hidden, so the report prints alone. */
export default function PrintButton({ label, icon }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      {icon}
      {label}
    </button>
  );
}
