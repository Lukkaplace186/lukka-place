import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, Grid3x3, PieChart } from 'lucide-react';
import AgentPageHeader from '@/components/AgentPageHeader';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile } from '@/lib/agencies';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { createAgentProjectAction } from '../actions';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.projects.wizard.newTitle'), robots: { index: false, follow: false } };
}

const TYPES = [
  { value: 'building', icon: Building2, key: 'building' },
  { value: 'portions', icon: PieChart, key: 'portions' },
  { value: 'lots', icon: Grid3x3, key: 'lots' },
];

/**
 * Step 0 of the developer wizard: what it is (three tiles) and its name.
 * Everything else is asked one screen at a time on /[id]/modifier, saved as
 * the developer goes, so a draft can be finished later on any device.
 */
export default async function NewAgentProjectPage({ searchParams }) {
  const t = await getT();
  const agentId = await getCurrentAgentId();
  if (!agentId) redirect('/compte/agent/connexion');
  const sp = await searchParams;
  const agent = await getAgentProfile(agentId);
  const verified = Boolean(agent?.phone_verified_at);
  const preselected = TYPES.some((type) => type.value === sp.type) ? sp.type : 'building';
  const errorKey = typeof sp.error === 'string' ? `agent.projects.wizard.errors.${sp.error}` : null;

  return (
    <>
      <AgentPageHeader title={t('agent.projects.wizard.newTitle')} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-3 py-4 sm:px-8 sm:py-7">
        <p className="u-micro text-ink-70">{t('agent.projects.wizard.newIntro')}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] font-semibold text-ink-70">
          <li>✓ {t('agent.projects.wizard.promise.time')}</li>
          <li>✓ {t('agent.projects.wizard.promise.review')}</li>
          <li>✓ {t('agent.projects.wizard.promise.free')}</li>
        </ul>

        {errorKey ? (
          <p className="rounded-lg bg-danger-tint px-4 py-2 text-sm font-semibold text-danger" role="alert">
            {t.has(errorKey) ? t(errorKey) : t('agent.projects.wizard.errors.generic')}
          </p>
        ) : null}

        {!verified ? (
          <div className="rounded-card border border-warning/40 bg-warning-tint p-4 text-sm text-ink">
            <p className="font-semibold">{t('agent.projects.wizard.unverifiedTitle')}</p>
            <p className="mt-1 text-ink-70">{t('agent.projects.wizard.unverifiedBody')}</p>
            <Link href="/compte/agent/inscription/verifier" className="mt-2 inline-block font-semibold text-blue-deep hover:underline">
              {t('agent.projects.wizard.unverifiedLink')}
            </Link>
          </div>
        ) : null}

        <form action={createAgentProjectAction} className="flex flex-col gap-5">
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="u-title-sub mb-2 text-ink">{t('agent.projects.wizard.typeLegend')}</legend>
            {TYPES.map(({ value, icon: Icon, key }) => (
              <label key={value} className="relative flex cursor-pointer flex-col gap-2 rounded-card border border-line bg-surface p-4 has-[:checked]:border-blue has-[:checked]:bg-blue-tint">
                <input type="radio" name="type" value={value} defaultChecked={value === preselected} className="peer sr-only" />
                <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7 text-blue-deep" />
                <span className="font-semibold text-ink">{t(`agent.projects.wizard.types.${key}.title`)}</span>
                <span className="text-[0.8125rem] text-ink-70">{t(`agent.projects.wizard.types.${key}.body`)}</span>
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="u-title-sub text-ink">{t('agent.projects.wizard.nameLabel')}</span>
            <input name="name" required maxLength={140} placeholder={t('agent.projects.wizard.namePlaceholder')} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm" />
          </label>

          <button type="submit" disabled={!verified} className="u-btn-primary inline-flex min-h-12 items-center justify-center rounded-full bg-blue px-6 text-sm font-semibold text-white disabled:opacity-40 sm:self-start">
            {t('agent.projects.wizard.start')}
          </button>
        </form>
      </div>
    </>
  );
}
