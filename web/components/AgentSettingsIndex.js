import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, ChevronRight, Circle, LogOut } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import LanguageToggle from './LanguageToggle';

/**
 * Réglages on a phone (2026-10-05 redesign): what is left to complete on top,
 * then the settings as grouped lists — Agence, Ventes, Compte — like a
 * phone's own settings app. Every row opens one section (`?section=`); the
 * language switch acts in place. From `lg` the page shows every card at once
 * instead, so this whole component is `lg:hidden`.
 *
 * The ring and the checklist are profileChecklist (lib/completenessRules.js):
 * agentProfileCompletion's items plus the gaps the overview's "Profil
 * incomplet" banner reads, so the two screens agree. A missing item links to
 * the field where it is fixed; done items fold into one line.
 */

// Which section fixes which checklist item.
const ITEM_SECTION = {
  'agent.completion.nameLabel': 'identity',
  'agent.completion.bioLabel': 'identity',
  'agent.completion.phoneLabel': 'identity',
  'agent.completion.photoLabel': 'identity',
  'agent.completion.verifiedLabel': 'verification',
  'agent.completion.communesLabel': 'communes',
};

function itemHref({ labelKey, href }) {
  if (href) return href;
  if (labelKey === 'agent.completion.listingLabel') return '/compte/agent/biens';
  const section = ITEM_SECTION[labelKey];
  return section ? `/compte/agent/parametres?section=${section}` : '/compte/agent/parametres';
}

function Ring({ percent }) {
  const r = 27;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--canvas-deep)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className={`u-tabular absolute inset-0 grid place-items-center font-extrabold text-ink ${percent >= 100 ? 'text-[0.75rem]' : 'text-[0.9375rem]'}`}>
        {percent}%
      </span>
    </div>
  );
}

function Row({ href, Icon, label, sub, external = false }) {
  return (
    <li>
      <Link
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="u-press flex min-h-14 items-center gap-3 px-3.5 py-2 hover:bg-canvas-alt"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-blue-tint text-blue">
          <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold text-ink">{label}</span>
          {sub && <span className="block truncate text-xs text-ink-45">{sub}</span>}
        </span>
        {external ? (
          <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-35" />
        ) : (
          <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-ink-35" />
        )}
      </Link>
    </li>
  );
}

export default async function AgentSettingsIndex({ agentName, agentInitials, checklist, groups, profilePath, logoutAction }) {
  const t = await getT();
  const missing = checklist.items.filter((item) => !item.done);
  const done = checklist.items.filter((item) => item.done);

  return (
    <nav aria-label={t('agent.settings.title')} className="flex flex-col gap-4 px-3 py-4 lg:hidden">
      <div className="u-card flex items-center gap-3 rounded-card bg-surface p-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-blue-tint text-lg font-extrabold text-blue-deep">
          {agentInitials || '·'}
        </span>
        <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-bold text-ink">{agentName}</span>
        <Link
          href={profilePath}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('agent.settings.viewMyPage')}
          className="u-press grid h-11 w-11 place-items-center rounded-lg text-blue hover:bg-blue-tint"
        >
          <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
        </Link>
      </div>

      <section className="u-card rounded-card bg-surface p-4" aria-labelledby="settings-progress-title">
        <div className="flex items-center gap-3.5">
          <Ring percent={checklist.percent} />
          <div className="min-w-0">
            <h2 id="settings-progress-title" className="text-base font-extrabold text-ink">
              {t('agent.settings.progressTitle', { percent: checklist.percent })}
            </h2>
            <p className="u-micro text-ink-45">{t('agent.settings.progressHint')}</p>
          </div>
        </div>
        {missing.length > 0 && (
          <ul className="mt-2 flex flex-col">
            {missing.map((item) => (
              <li key={item.key} className="border-t border-line first:border-t-0">
                <Link href={itemHref(item)} className="u-press flex min-h-11 items-center gap-2.5 text-sm font-semibold text-ink">
                  <Circle strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-ink-25" aria-hidden="true" />
                  <span className="min-w-0 flex-1">{t(item.labelKey)}</span>
                  <span className="inline-flex items-center text-[0.8125rem] font-bold text-blue">
                    {t('agent.settings.add')}
                    <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details className="group border-t border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 text-sm font-bold text-blue [&::-webkit-details-marker]:hidden">
              <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              {t('agent.settings.doneItems', { count: done.length })}
            </summary>
            <ul className="flex flex-col pb-1">
              {done.map((item) => (
                <li key={item.key} className="flex min-h-9 items-center gap-2.5 pl-[1.875rem] text-[0.8125rem] text-ink-45">
                  {t(item.labelKey)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {groups.map((group) => (
        <div key={group.key}>
          <div className="mb-1.5 px-1 text-xs font-bold uppercase tracking-[0.08em] text-ink-45">{t(group.labelKey)}</div>
          <ul className="u-card divide-y divide-line overflow-hidden rounded-card bg-surface">
            {group.rows.map((row) =>
              row.key === 'language' ? (
                <li key="language" className="flex min-h-14 items-center gap-3 px-3.5 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-blue-tint text-blue">
                    <row.Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                  </span>
                  <span className="min-w-0 flex-1 text-[0.9375rem] font-semibold text-ink">{t('common.language.label')}</span>
                  <LanguageToggle />
                </li>
              ) : (
                <Row key={row.key} href={row.href} Icon={row.Icon} label={t(row.labelKey)} sub={row.sub} external={row.external} />
              ),
            )}
          </ul>
        </div>
      ))}

      <form action={logoutAction} className="u-card overflow-hidden rounded-card bg-surface">
        <button
          type="submit"
          className="u-press flex min-h-14 w-full items-center justify-center gap-2 text-[0.9375rem] font-bold text-danger hover:bg-danger-tint"
        >
          <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
          {t('common.actions.logout')}
        </button>
      </form>
    </nav>
  );
}
