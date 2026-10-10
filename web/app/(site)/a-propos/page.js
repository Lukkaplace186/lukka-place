import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, CalendarCheck, Layers, MapPin, MessageCircle, PhoneCall } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import { getT } from '@/lib/i18n/server';
import heroPhoto from '../../../Hero/about-moving-in.jpg';
import bukavuPhoto from '../../../Hero/about-bukavu.jpg';
import buildingPhoto from '../../../Hero/about-building.jpg';
import flagPhoto from '../../../Hero/about-flag.jpg';

const HERO_PHOTO_CREDIT = {
  name: 'Gustavo Fring',
  href: 'https://www.pexels.com/photo/a-happy-young-couple-holding-cardboard-boxes-4971211/',
};

/*
 * `generateMetadata`, not a static `metadata` object: a static export is
 * evaluated once at module load and so cannot see the request's locale. The
 * <title> and the share-card description are user-facing copy like any other
 * — an English visitor sharing this page should not put a French card into
 * their WhatsApp thread.
 */
export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('about.metaTitle'),
    description: t('about.metaDescription'),
  };
}

/*
 * Who we are (2026-10-07, copy rewritten 2026-10-10): a full-bleed photo with
 * the promise, the ambition beside photos (Kinshasa first, then the whole
 * DRC), four reasons to search here, a call to action, the agent side, then
 * the fine print.
 *
 * The live-figures band is gone (product direction, 2026-10-10), and so is
 * the "Bukavu" tag on the aerial photo: the section is about the whole
 * country, and the photo's alt text still says where it was taken. The photos
 * are Pexels photos the owner chose, credited under them.
 */
export default async function AboutPage() {
  const t = await getT();
  const changes = [
    { icon: PhoneCall, title: t('about.change1Title'), body: t('about.change1Body') },
    { icon: BadgeCheck, title: t('about.change2Title'), body: t('about.change2Body') },
    { icon: MapPin, title: t('about.change3aTitle'), body: t('about.change3aBody') },
    { icon: CalendarCheck, title: t('about.change4Title'), body: t('about.change4Body') },
  ];
  const steps = [
    { icon: MessageCircle, title: t('about.agentsStep1Title'), body: t('about.agentsStep1Body') },
    { icon: Layers, title: t('about.agentsStep2Title'), body: t('about.agentsStep2Body') },
    { icon: CalendarCheck, title: t('about.agentsStep3Title'), body: t('about.agentsStep3Body') },
  ];

  return (
    <div className="bg-canvas">
      {/* Hero — the move. A bright photo, so the copy is ink on its white
          wall (desktop) or under it (phone), where the couple would
          otherwise sit behind the headline. */}
      <section className="relative isolate overflow-hidden bg-canvas">
        <div className="relative aspect-[4/3] w-full sm:aspect-[16/9] lg:absolute lg:inset-y-0 lg:right-0 lg:-z-10 lg:aspect-auto lg:w-[60%]">
          <Image
            src={heroPhoto}
            alt={t('about.heroPhotoAlt')}
            fill
            placeholder="blur"
            sizes="100vw"
            fetchPriority="high"
            loading="eager"
            className="object-cover object-[72%_30%] lg:object-[62%_30%]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 hidden w-1/3 bg-gradient-to-r from-canvas to-transparent lg:block"
          />
          {/* Pexels licence: no credit required; given anyway, as for every
              photo on this site. */}
          <a
            href={HERO_PHOTO_CREDIT.href}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-2 right-2 rounded-full bg-white/80 px-2 py-0.5 text-[0.6875rem] text-ink-70 hover:text-ink"
          >
            {t('about.photoCredit', { name: HERO_PHOTO_CREDIT.name })}
          </a>
        </div>
        <div className="mx-auto flex max-w-[1600px] flex-col px-4 pb-8 pt-5 sm:px-6 sm:pb-14 sm:pt-8 lg:min-h-[38rem] lg:justify-center lg:px-8 lg:py-16">
          <Breadcrumb items={[{ label: t('breadcrumb.home'), href: '/' }, { label: t('about.eyebrow') }]} />
          <p className="u-eyebrow mt-5 sm:mt-8 lg:mt-14">{t('about.heroKicker')}</p>
          <h1 className="mt-2 max-w-2xl sm:mt-4 font-display text-[2.5rem] font-normal leading-[1.04] tracking-[-0.02em] text-ink sm:text-[3.5rem] lg:max-w-[38%] lg:text-[3.5rem] xl:text-[4rem]">
            <Accented text={t('about.heroTitle')} accent={t('about.heroAccent')} className="text-blue" />
          </h1>
          <p className="mt-3 max-w-xl text-[1.0625rem] sm:mt-6 leading-relaxed text-ink-70 sm:text-lg lg:max-w-[36%]">{t('about.heroLead')}</p>
          <div className="mt-5 flex flex-wrap gap-3 sm:mt-8">
            <Link
              href="/listings"
              className="u-btn-primary inline-flex min-h-11 items-center rounded-full bg-blue px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
            >
              {t('about.ctaBrowse')}
            </Link>
            <Link
              href="/compte/agent/inscription"
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-semibold text-ink transition-colors hover:border-ink-45"
            >
              {t('about.ctaAgent')}
            </Link>
          </div>
        </div>
      </section>

      {/* Vision — the statement beside the country it is for. */}
      <section className="mx-auto grid max-w-[1600px] items-center gap-6 px-4 py-10 sm:gap-10 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:px-8">
        <div>
          <p className="u-eyebrow mb-2 sm:mb-4">{t('about.visionEyebrow')}</p>
          <h2 className="font-display text-[2rem] font-normal leading-[1.1] tracking-[-0.02em] text-ink sm:text-[2.75rem]">
            <Accented text={t('about.visionTitle')} accent={t('about.visionAccent')} className="text-blue" />
          </h2>
          <div className="u-body mt-3 flex max-w-xl flex-col gap-3 text-ink-70 sm:mt-6">
            <p>{t('about.visionBody')}</p>
            <p>{t('about.visionBody2')}</p>
            <p>{t('about.visionBody3')}</p>
          </div>
        </div>

        <figure>
          <div className="grid aspect-[4/3] grid-cols-[1.4fr_1fr] grid-rows-2 gap-3">
            <div className="relative row-span-2 overflow-hidden rounded-2xl bg-ink">
              <Image src={bukavuPhoto} alt={t('about.visionPhotoBukavuAlt')} fill placeholder="blur" sizes="(min-width: 1024px) 28vw, 58vw" className="object-cover" />
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-ink">
              <Image src={buildingPhoto} alt={t('about.visionPhotoBuildingAlt')} fill placeholder="blur" sizes="(min-width: 1024px) 20vw, 40vw" className="object-cover object-[50%_30%]" />
            </div>
            <div className="relative overflow-hidden rounded-2xl bg-ink">
              <Image src={flagPhoto} alt={t('about.visionPhotoFlagAlt')} fill placeholder="blur" sizes="(min-width: 1024px) 20vw, 40vw" className="object-cover object-[50%_55%]" />
            </div>
          </div>
          <figcaption className="u-meta mt-3 text-ink-45">{t('about.visionPhotoCredit')}</figcaption>
        </figure>
      </section>

      {/* Why here — four reasons, one line each. */}
      <section className="bg-canvas-alt py-10 sm:py-28">
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
          <p className="u-eyebrow mb-2 sm:mb-3">{t('about.changeEyebrow')}</p>
          <h2 className="font-display text-[1.75rem] font-normal leading-[1.15] tracking-[-0.01em] text-ink sm:text-[2.25rem]">
            {t('about.changeTitle')}
          </h2>
          <div className="mt-5 grid gap-3 sm:mt-10 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {changes.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-2xl border border-line bg-surface p-5 sm:p-8">
                <Icon size={24} strokeWidth={1.5} aria-hidden="true" className="text-blue" />
                <h3 className="u-title-card mt-3 text-ink sm:mt-5">{title}</h3>
                <p className="u-body mt-2 text-ink-70">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* The ask — browse, or tell us what you are looking for. */}
      <section className="bg-blue text-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-10 sm:px-6 sm:py-16 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="max-w-2xl">
            <p className="u-eyebrow !text-white/75">{t('about.startEyebrow')}</p>
            <h2 className="mt-2 font-display text-[1.75rem] font-normal leading-[1.15] tracking-[-0.01em] sm:text-[2.25rem]">
              {t('about.startTitle')}
            </h2>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-white/85 sm:text-base">{t('about.startBody')}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/listings"
              className="inline-flex min-h-11 items-center rounded-full bg-white px-6 text-sm font-semibold text-blue-deep transition-colors hover:bg-white/90"
            >
              {t('about.ctaBrowse')}
            </Link>
            <Link
              href="/compte/client/demandes"
              className="inline-flex min-h-11 items-center rounded-full border border-white/50 px-6 text-sm font-semibold text-white transition-colors hover:border-white"
            >
              {t('about.startFindForMe')}
            </Link>
          </div>
        </div>
      </section>

      {/* For agents — the WhatsApp intake, in three steps. */}
      <section className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 sm:py-28 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="u-eyebrow mb-2 sm:mb-3">{t('about.agentsEyebrow')}</p>
            <h2 className="font-display text-[1.75rem] font-normal leading-[1.15] tracking-[-0.01em] text-ink sm:text-[2.25rem]">
              {t('about.agentsTitle')}
            </h2>
          </div>
          <Link
            href="/compte/agent/inscription"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full bg-green px-6 text-sm font-semibold text-white transition-colors hover:bg-green-deep sm:self-auto"
          >
            <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />
            {t('about.agentsCta')}
          </Link>
        </div>
        <ol className="mt-5 grid gap-3 sm:mt-10 sm:gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="relative rounded-2xl border border-line bg-surface p-5 sm:p-8">
              <span className="u-tabular font-display text-[2.5rem] leading-none text-blue/25">{String(i + 1).padStart(2, '0')}</span>
              <Icon size={22} strokeWidth={1.5} aria-hidden="true" className="absolute right-5 top-6 text-blue sm:right-8 sm:top-9" />
              <h3 className="u-title-card mt-2 text-ink sm:mt-4">{title}</h3>
              <p className="u-body mt-2 text-ink-70">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* The fine print the old page was made of. */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 sm:py-14 lg:px-8">
          <h2 className="u-title-sub text-ink">{t('about.notesTitle')}</h2>
          <div className="mt-3 flex max-w-3xl flex-col gap-3 text-[0.875rem] leading-relaxed text-ink-45">
            <p>{t('about.body3')}</p>
            <p>{t('about.body4')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * A heading with one phrase in colour. The heading stays ONE dictionary
 * string (so the capitalisation rules see a whole sentence) and the accent is
 * a phrase found inside it; a translation that drops the phrase just renders
 * the heading plain.
 */
function Accented({ text, accent, className }) {
  const at = accent ? text.toLowerCase().indexOf(accent.toLowerCase()) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className={className}>{text.slice(at, at + accent.length)}</span>
      {text.slice(at + accent.length)}
    </>
  );
}
