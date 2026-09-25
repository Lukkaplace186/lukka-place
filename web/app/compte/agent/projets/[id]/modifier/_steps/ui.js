/** Small shared pieces of the wizard's step screens (server components). */

export const INPUT = 'min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
export const TEXTAREA = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink';
export const PRIMARY = 'u-btn-primary inline-flex min-h-11 items-center justify-center rounded-full bg-blue px-5 text-sm font-semibold text-white';
export const SECONDARY = 'inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink hover:border-ink-25';

export function Field({ label, hint = null, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="u-micro-strong text-ink-70">{label}</span>
      {children}
      {hint ? <span className="text-[0.75rem] text-ink-45">{hint}</span> : null}
    </label>
  );
}

export function Section({ id, title, intro = null, children }) {
  return (
    <section id={id} className="flex scroll-mt-28 flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6">
      <div>
        <h2 className="u-title-card text-ink">{title}</h2>
        {intro ? <p className="u-micro mt-1 text-ink-70">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** The step's "Enregistrer et continuer" row; `stay` saves without moving on. */
export function StepButtons({ t, back = null }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" className={PRIMARY}>{t('agent.projects.wizard.saveNext')}</button>
      <button type="submit" name="stay" value="1" className={SECONDARY}>{t('agent.projects.wizard.save')}</button>
      {back}
    </div>
  );
}

export function usd(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${Math.round(Number(value)).toLocaleString('fr-FR')} $`;
}
