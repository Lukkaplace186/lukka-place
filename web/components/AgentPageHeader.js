/**
 * Sticky section header shared by every app/compte/agent/** page — real
 * page title + an optional action slot (e.g. the "Ajouter un bien" CTA).
 * No search input or notification bell: neither has a real target in this
 * app (no dashboard-wide search, no notification system), same call
 * AgentDashboardView.js already made for this exact reason.
 */
export default function AgentPageHeader({ title, subtitle, action }) {
  return (
    <header className="sticky top-0 z-10 flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3 sm:px-8">
      <div>
        <h1 className="font-display text-[1.625rem] font-normal leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-45">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
