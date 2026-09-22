import Link from 'next/link';
import { Bell, SlidersHorizontal, Plus, MessageCircle, ArrowRight } from 'lucide-react';
import PropertyCard from '@/components/PropertyCard';
import { PortalPanel, PortalEmpty } from '@/components/ClientPortalUI';
import { searchCriteriaTags } from '@/lib/searchLabel';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { RemovableAlert, RemoveAlertButton } from './RemovableAlert';
import AlertPreferences from './AlertPreferences';
import { formatPhoneDisplay } from '@/lib/phone';

function lastAlertedLabel(value, locale) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Kinshasa',
  }).format(date);
}
import { getT, getLocale } from '@/lib/i18n/server';

const SHOWN_PER_SEARCH = 3;

/**
 * "Mes alertes" board, extracted out of the old standalone
 * `/compte/client/alertes` page so the merged "Favoris & Alertes" tab
 * (`../page.js`) can render it as a sub-view without duplicating this JSX.
 * `matches` is the real, already-computed `getSavedSearchMatches()` result
 * (lib/alerts.js) — this component only renders, it never fetches.
 */
export default async function AlertsBoard({ matches, whatsappHref, phone = null, optedOut = false }) {
  const t = await getT();
  const locale = await getLocale();
  if (matches.length === 0) {
    return (
      <PortalEmpty
        icon={Bell}
        title={t('account.alerts.emptyTitle')}
        actionLabel={t('account.favorites.browseListings')}
        actionHref="/listings"
      >
        {t('account.alerts.emptyBody')}
      </PortalEmpty>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start">
      <div>
        {/* No heading: the "Alertes (N)" pill above already names and counts these. */}
        <div className="flex flex-col gap-5">
          {matches.map(({ search, newListings, newCount, total }) => {
            const tags = searchCriteriaTags(new URLSearchParams(search.query), t);
            const shown = newListings.slice(0, SHOWN_PER_SEARCH);

            return (
              <RemovableAlert key={search.id} query={search.query} label={search.label}>
              <PortalPanel className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="u-title-card text-ink">{search.label}</h3>
                    <p
                      className={`mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold ${
                        newCount > 0 ? 'text-blue-deep' : 'text-ink-45'
                      }`}
                    >
                      <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                      {newCount > 0
                        ? t('account.alerts.newSinceLastVisit', { count: newCount })
                        : t('account.alerts.noneSinceLastVisit')}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/listings?${search.query}`}
                      aria-label={t('account.alerts.editSearchNamed', { label: search.label })}
                      title={t('account.alerts.editSearch')}
                      className="u-press inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-45 transition-colors hover:bg-canvas-deep hover:text-ink"
                    >
                      <SlidersHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <RemoveAlertButton label={search.label} />
                  </div>
                </div>

                <AlertPreferences
                  savedSearchId={search.id}
                  label={search.label}
                  frequency={search.alert_frequency || 'weekly'}
                  lastAlertedLabel={lastAlertedLabel(search.last_alerted_at, locale)}
                />

                {tags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <span key={tag} className="u-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="my-5 h-px bg-line" />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="u-tabular text-[0.8125rem] text-ink-45">
                    {t('account.alerts.matchingTotal', { count: total })}
                  </span>
                  <Link
                    href={`/listings?${search.query}`}
                    className="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-blue-deep hover:underline"
                  >
                    {t('account.alerts.seeAllResults')}
                    <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>

                {shown.length > 0 ? (
                  <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.map((listing) => (
                      <PropertyCard key={listing.id} listing={listing} />
                    ))}
                  </div>
                ) : null}
              </PortalPanel>
              </RemovableAlert>
            );
          })}
        </div>
      </div>

      <PortalPanel as="aside" className="flex flex-col gap-5 p-6">
        <div>
          <h3 className="u-title-card text-ink">{t('account.alerts.howNotified')}</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.5] text-ink-45">
            {t('account.alerts.howItWorksBody')}
          </p>
        </div>

        <div className="h-px bg-line" />

        {/* This used to say there was no automatic WhatsApp sending at all,
            while the weekly sweep was already sending. It now states what
            actually happens for THIS account, and where to stop it. */}
        <p className="text-[0.8125rem] leading-[1.5] text-ink-45">
          {optedOut
            ? t('account.alerts.whatsappOff')
            : t('account.alerts.whatsappOn', { phone: formatPhoneDisplay(phone) })}
        </p>
        <Link
          href="/compte/client/parametres"
          className="text-[0.8125rem] font-semibold text-blue-deep hover:underline"
        >
          {t('account.alerts.manageInProfile')}
        </Link>

        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-green px-5 py-2.5 text-[0.875rem] font-semibold text-white transition-colors hover:bg-green-deep"
          >
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('account.alerts.discussWhatsApp')}
          </a>
        ) : null}

        <Link
          href="/listings"
          className="u-btn-secondary inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[0.875rem] font-semibold text-ink"
        >
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('account.alerts.create')}
        </Link>
      </PortalPanel>
    </div>
  );
}
