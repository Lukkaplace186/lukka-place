import Link from 'next/link';
import {
  BadgeCheck, BarChart3, Building2, CalendarClock, Globe2, LandPlot, MessageCircle, Wallet,
} from 'lucide-react';
import PhoneField from '@/components/PhoneField';
import { submitDeveloperApplicationAction } from './actions';
import { getDemandReport } from '@/lib/adminApi';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('projects.developers.metaTitle'),
    description: t('projects.developers.metaDescription'),
    alternates: { canonical: '/promoteurs' },
  };
}

/**
 * A commune is only named publicly once at least this many distinct customers
 * asked for it — below that a count can point at one identifiable person.
 */
const PUBLIC_DEMAND_MIN_CUSTOMERS = 3;

async function publicDemand() {
  try {
    const report = await getDemandReport({ days: 90, limit: 1 });
    return {
      customers: report.customers,
      communes: (report.communes || []).filter((c) => c.customers >= PUBLIC_DEMAND_MIN_CUSTOMERS).slice(0, 6),
    };
  } catch (err) {
    console.error(`[promoteurs] demand unavailable: ${err.message}`);
    return null;
  }
}

const FEATURES = [
  { icon: Building2, titleKey: 'projects.developers.f1Title', bodyKey: 'projects.developers.f1Body' },
  { icon: CalendarClock, titleKey: 'projects.developers.f2Title', bodyKey: 'projects.developers.f2Body' },
  { icon: LandPlot, titleKey: 'projects.developers.f3Title', bodyKey: 'projects.developers.f3Body' },
  { icon: Wallet, titleKey: 'projects.developers.f4Title', bodyKey: 'projects.developers.f4Body' },
  { icon: MessageCircle, titleKey: 'projects.developers.f5Title', bodyKey: 'projects.developers.f5Body' },
  { icon: Globe2, titleKey: 'projects.developers.f6Title', bodyKey: 'projects.developers.f6Body' },
];

/**
 * /promoteurs — why a developer should launch on Lukka Place, the real demand
 * we see (aggregated, 90 days, communes with ≥3 distinct customers only), and
 * a short application the team follows up by phone.
 */
export default async function DevelopersPage({ searchParams }) {
  const t = await getT();
  const sp = await searchParams;
  const sent = sp.sent === '1';
  const error = typeof sp.error === 'string' ? sp.error : null;
  const demand = await publicDemand();

  return (
    <div className="pb-16">
      <section className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <p className="u-eyebrow text-white/60">{t('projects.developers.eyebrow')}</p>
          <h1 className="u-title-hero max-w-3xl text-white">{t('projects.developers.title')}</h1>
          <p className="max-w-2xl text-[1rem] leading-relaxed text-white/80">{t('projects.developers.subtitle')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/compte/agent/projets/nouveau" className="u-press inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-ink">
              {t('projects.developers.selfServe')}
            </Link>
            <a href="#presenter" className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-white shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.6)] hover:bg-white/10">
              {t('projects.developers.cta')}
            </a>
            <Link href="/projets" className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-white shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.6)] hover:bg-white/10">
              {t('projects.developers.seeProjects')}
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-7xl flex-col gap-14 px-4 pt-12 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-6">
          <h2 className="u-title-section text-ink">{t('projects.developers.featuresTitle')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, titleKey, bodyKey }) => (
              <li key={titleKey} className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
                <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6 text-blue-deep" />
                <p className="u-title-card text-ink">{t(titleKey)}</p>
                <p className="text-sm leading-relaxed text-ink-70">{t(bodyKey)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-6 rounded-card bg-surface p-6 shadow-[var(--hairline)] sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <BarChart3 strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7 text-blue-deep" />
            <h2 className="u-title-section text-ink">{t('projects.developers.demandTitle')}</h2>
            <p className="text-sm leading-relaxed text-ink-70">{t('projects.developers.demandBody')}</p>
            <p className="text-[0.75rem] text-ink-45">{t('projects.developers.demandNote', { min: PUBLIC_DEMAND_MIN_CUSTOMERS })}</p>
          </div>
          {demand && demand.communes.length ? (
            <ol className="flex flex-col gap-2">
              {demand.communes.map((row, index) => {
                const max = demand.communes[0].customers || 1;
                return (
                  <li key={row.commune} className="flex items-center gap-3">
                    <span className="u-tabular w-5 text-right text-sm text-ink-45">{index + 1}</span>
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-semibold text-ink">{row.commune}</span>
                        <span className="u-tabular text-ink-70">{t('projects.developers.customers', { count: row.customers })}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-canvas-alt">
                        <div className="h-full rounded-full bg-blue" style={{ width: `${Math.max(6, (row.customers / max) * 100)}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="self-center rounded-lg bg-canvas-alt p-4 text-sm text-ink-70">{t('projects.developers.demandEmpty')}</p>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 sm:p-8">
          <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-7 w-7 text-success" />
          <h2 className="u-title-section text-ink">{t('projects.developers.verifyTitle')}</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-70">{t('projects.developers.verifyBody')}</p>
        </section>

        <section id="presenter" className="grid scroll-mt-24 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <h2 className="u-title-section text-ink">{t('projects.developers.formTitle')}</h2>
            <p className="text-sm leading-relaxed text-ink-70">{t('projects.developers.formBody')}</p>
            <p className="text-sm text-ink-70">
              {t('projects.developers.haveAccount')}{' '}
              <Link href="/compte/agent/inscription" className="font-semibold text-blue-deep hover:underline">{t('projects.developers.createAccount')}</Link>
            </p>
          </div>
          {sent ? (
            <div className="rounded-card bg-success-tint p-6 text-success" role="status">
              <p className="font-semibold">{t('projects.developers.sentTitle')}</p>
              <p className="mt-1 text-sm">{t('projects.developers.sentBody')}</p>
            </div>
          ) : (
            <form action={submitDeveloperApplicationAction} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 sm:p-6">
              {error ? (
                <p className="rounded-lg bg-danger-tint px-3 py-2 text-sm font-semibold text-danger" role="alert">
                  {error === 'phone' ? t('projects.enquiry.errorPhone') : t('projects.enquiry.error')}
                </p>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink-70">{t('projects.developers.name')}</span>
                <input name="name" required maxLength={120} autoComplete="name" className="min-h-11 rounded-lg border border-line px-3 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink-70">{t('projects.developers.company')}</span>
                <input name="company" maxLength={140} autoComplete="organization" className="min-h-11 rounded-lg border border-line px-3 text-sm" />
              </label>
              <PhoneField name="phone" id="developer-phone" locale={t.locale} labels={{ ...phoneFieldLabels(t), label: t('enquiry.whatsappNumber') }} required />
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink-70">{t('projects.developers.kind')}</span>
                <select name="kind" defaultValue="off_plan" className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm">
                  <option value="off_plan">{t('projects.kind.offPlan')}</option>
                  <option value="building">{t('projects.kind.building')}</option>
                  <option value="land">{t('projects.kind.land')}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="u-micro-strong text-ink-70">{t('projects.developers.project')}</span>
                <textarea name="project" rows={4} maxLength={1000} placeholder={t('projects.developers.projectPlaceholder')} className="rounded-lg border border-line px-3 py-2 text-sm" />
              </label>
              <button type="submit" className="u-btn-primary inline-flex min-h-11 items-center justify-center rounded-full bg-blue px-5 text-sm font-semibold text-white">
                {t('projects.developers.submit')}
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
