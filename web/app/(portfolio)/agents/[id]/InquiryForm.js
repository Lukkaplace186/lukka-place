import { submitInquiryAction } from './actions';
import { getT } from '@/lib/i18n/server';

/**
 * The design's "Envoyer un message à l'agence" card — a white panel at
 * shadow-md carrying name / WhatsApp / type / budget / message, then a
 * full-width primary submit and a closing note.
 *
 * Server-Action-backed with no client wrapper, matching this app's
 * convention for every other write form: feedback arrives via redirect +
 * ?inquiry_sent=1 / ?inquiry_error=, read by the parent page.
 *
 * The type and budget selects are real inputs, not decoration: the engine's
 * POST /admin/leads has no structured columns for either, so
 * submitInquiryAction folds both into the lead's `requirements_summary`
 * text, which is exactly where an agent reads them back on their dashboard.
 * The option lists are fixed choices (not derived from the database)
 * because they describe what the *visitor* wants, not what currently
 * exists — the same reason a budget filter offers ranges no listing may
 * match today.
 *
 * The design's closing note is "Réponse habituelle en moins de 4 heures."
 * Nothing measures response time, so that claim is not made; the note says
 * what actually happens to the message instead.
 */
const TYPE_OPTIONS = ['Maison', 'Appartement', 'Parcelle', 'Bureau ou commerce'];
const BUDGET_OPTIONS = ['Moins de 1 000 $', '1 000 – 2 500 $', '2 500 – 5 000 $', 'Plus de 5 000 $'];

const FIELD_CLASS =
  'u-focus-ring h-10 w-full rounded-lg border border-line/70 bg-surface px-3 text-sm leading-normal text-ink transition-colors placeholder:text-ink-35 hover:border-line';

export default async function InquiryForm({ agentId, agentName, sent, error }) {
  const t = await getT();
  const bound = submitInquiryAction.bind(null, agentId);

  if (sent) {
    return (
      <div className="u-card rounded-card bg-surface p-6 text-center">
        <p className="u-title-card text-ink">{t('agent.portfolio.requestSent')}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-70">
          {agentName} a reçu votre message et vous répondra sur WhatsApp au numéro que vous avez laissé.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line/60 bg-surface p-4">
      <h3 className="u-title-card text-ink">{t('agent.portfolio.sendMessage')}</h3>

      <form action={bound} className="mt-3.5 flex flex-col gap-3">
        <div>
          <label htmlFor="inquiry-name" className="mb-1 block text-xs font-semibold text-ink-70">
            {t('account.profile.fullName')}
          </label>
          <input id="inquiry-name" name="name" placeholder="Votre nom" className={FIELD_CLASS} />
        </div>

        <div>
          <label htmlFor="inquiry-phone" className="mb-1 block text-xs font-semibold text-ink-70">
            {t('enquiry.whatsappNumber')}
          </label>
          <input
            id="inquiry-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            placeholder={t('enquiry.whatsappPlaceholder')}
            className={FIELD_CLASS}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="inquiry-type" className="mb-1 block text-xs font-semibold text-ink-70">
              {t('listings.filters.propertyType')}
            </label>
            <select id="inquiry-type" name="property_type" defaultValue="" className={FIELD_CLASS}>
              <option value="">{t('agent.portfolio.noPreference')}</option>
              {TYPE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inquiry-budget" className="mb-1 block text-xs font-semibold text-ink-70">
              {t('account.requests.budget')}
            </label>
            <select id="inquiry-budget" name="budget" defaultValue="" className={FIELD_CLASS}>
              <option value="">{t('agent.portfolio.noPreference')}</option>
              {BUDGET_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="inquiry-message" className="mb-1 block text-xs font-semibold text-ink-70">
            {t('agent.portfolio.yourMessage')}
          </label>
          <textarea
            id="inquiry-message"
            name="message"
            rows={3}
            placeholder={t('agent.portfolio.messagePlaceholder')}
            className="u-focus-ring w-full resize-y rounded-lg border border-line/70 bg-surface p-3 text-sm leading-relaxed text-ink transition-colors placeholder:text-ink-35 hover:border-line"
          />
        </div>

        {error && (
          <p className="text-sm font-semibold text-danger" role="alert">
            {error === 'phone' ? t('enquiry.errors.phone') : t('enquiry.errors.failed')}
          </p>
        )}

        <button
          type="submit"
          className="u-btn-primary u-press h-11 w-full rounded-lg bg-blue text-sm font-bold text-white"
        >
          {t('enquiry.submit')}
        </button>

        <p className="text-center text-xs text-ink-35">
          Votre message arrive dans la boîte de réception de l&apos;agence sur Lukka Place.
        </p>
      </form>
    </div>
  );
}
