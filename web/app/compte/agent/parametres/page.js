import Link from 'next/link';
import { BadgeCheck, ArrowUpRight, Check, Circle } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getLocationHierarchySafe } from '@/lib/locations';
import { formatPhoneDisplay } from '@/lib/phone';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentAvatarUpload from '@/components/AgentAvatarUpload';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentVerificationBadge from '@/components/AgentVerificationBadge';
import { getAgentVerification } from '@/lib/agentVerification';
import { DOC_STATUS_LABEL_KEYS, DOC_TYPE_LABEL_KEYS, LEVEL_LABEL_KEYS, VERIFICATION_DOC_TYPES } from '@/lib/verificationLevels';
import { uploadVerificationDocumentAction } from '../verificationActions';
import {
  updateAgentIdentityAction,
  changeAgentPasswordAction,
  updateOwnCommunesAction,
  updateWorkingHoursAction,
} from '../actions';
import { getT } from '@/lib/i18n/server';

// Keys, not text: this is a module-level constant, evaluated once at import
// time, so `t` does not exist here and a string baked in would be frozen in
// whichever language happened to load first. Resolved at render below —
// same rule components/navItems.js documents.
const ERROR_MESSAGE_KEYS = {
  too_short: 'agent.settings.passwordTooShort',
  mismatch: 'agent.settings.passwordMismatch',
  wrong_password: 'agent.settings.wrongPassword',
  name_required: 'agent.settings.nameRequired',
};

// lib/agentVerification.js's submitVerificationDocument failure codes; anything
// else in the URL is ignored rather than echoed.
const VERIFICATION_ERROR_CODES = ['invalid_type', 'empty', 'too_large', 'bad_format', 'too_many_pending', 'upload_failed'];

const DOC_STATUS_TONE = {
  pending: 'bg-canvas-alt text-ink-70',
  approved: 'bg-success-tint text-success',
  rejected: 'bg-danger-tint text-danger',
};

export default async function AgentSettingsPage({ searchParams }) {
  const t = await getT();
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const saved = typeof params.saved === 'string' ? params.saved : null;
  const passwordSuccess = params.success === '1';

  const agentId = await getCurrentAgentId();
  const verificationError =
    typeof params.verification_error === 'string' && VERIFICATION_ERROR_CODES.includes(params.verification_error)
      ? params.verification_error
      : null;

  const [{ agent, completion }, { communes, degraded }, verification] = await Promise.all([
    getAgentDashboardContext(agentId),
    getLocationHierarchySafe(),
    // Degrade, don't die: before the verification migration runs (or with
    // Postgres briefly unreachable) the card says so; the page still renders.
    getAgentVerification(agentId).catch((err) => {
      console.error(`[compte/agent/parametres] verification read failed: ${err.message}`);
      return null;
    }),
  ]);

  const profileUrl = `${SITE_URL}/agents/${agent.id}`;
  const selectedCommunes = new Set(agent.primary_communes || []);
  const boundUpdateCommunes = updateOwnCommunesAction.bind(null, communes);

  return (
    <>
      <AgentPageHeader title={t('agent.settings.title')} newLeadsCount={0} />

      <div className="grid grid-cols-1 gap-6 px-3 py-4 sm:px-8 sm:py-7 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:items-start">
        <div className="flex flex-col gap-6">
        <div className="u-card flex flex-col gap-5 rounded-card bg-surface p-4 sm:p-6">
          <div>
            <h2 className="u-title-card text-ink">{t('agent.settings.identityTitle')}</h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-45">
              {t('agent.settings.identityHint')}
            </p>
          </div>

          <AgentAvatarUpload initialSrc={agent.image} />

          <form action={updateAgentIdentityAction} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="first_name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                  {t('agent.settings.firstName')}
                </label>
                <input
                  id="first_name"
                  name="first_name"
                  defaultValue={agent.first_name || ''}
                  className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                />
              </div>
              <div>
                <label htmlFor="last_name" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                  Nom
                </label>
                <input
                  id="last_name"
                  name="last_name"
                  defaultValue={agent.last_name || ''}
                  className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="bio" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                {t('agent.settings.bio')}
              </label>
              <textarea
                id="bio"
                name="bio"
                rows={4}
                defaultValue={agent.bio || ''}
                placeholder={t('agent.settings.bioPlaceholder')}
                className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">{t('agent.settings.whatsappNumber')}</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-line bg-canvas-alt px-3 text-sm text-ink-45">
                <span className="u-tabular text-ink">{formatPhoneDisplay(agent.phone) || 'Non renseigné'}</span>
                {agent.phone_verified_at && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                    <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('agent.settings.verified')}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-ink-35">
                C&apos;est ce numéro qui reçoit les demandes et qui vous identifie à la connexion. Le changer demande
                une nouvelle vérification par code — contactez l&apos;équipe Lukka Place.
              </p>
            </div>

            {saved === 'identity' && (
              <p className="text-sm font-semibold text-success" role="status">
                {t('agent.settings.saved')}
              </p>
            )}
            {error === 'name_required' && (
              <p className="text-sm font-semibold text-danger" role="alert">
                {t(ERROR_MESSAGE_KEYS.name_required)}
              </p>
            )}

            <div className="flex gap-2.5">
              <button
                type="submit"
                className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white"
              >
                {t('agent.settings.saveChanges')}
              </button>
              <Link
                href="/compte/agent/parametres"
                className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 transition-colors hover:bg-canvas-alt hover:text-ink"
              >
                {t('common.actions.cancel')}
              </Link>
            </div>
          </form>
        </div>

        <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
          <div>
            <h2 className="u-title-card text-ink">{t('agent.settings.communesTitle')}</h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-45">
              {t('agent.settings.communesHint')}
            </p>
          </div>

          {degraded ? (
            <p className="text-[0.8125rem] text-ink-45">
              {t('agent.settings.communesUnavailable')}
            </p>
          ) : (
            <form action={boundUpdateCommunes} className="flex flex-col gap-4">
              <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto sm:grid-cols-3">
                {communes.map((commune) => (
                  <label key={commune} className="flex items-center gap-2 text-[0.8125rem] text-ink-70">
                    <input type="checkbox" name="communes" value={commune} defaultChecked={selectedCommunes.has(commune)} />
                    {commune}
                  </label>
                ))}
              </div>

              {saved === 'communes' && (
                <p className="text-sm font-semibold text-success" role="status">
                  {t('agent.settings.communesSaved')}
                </p>
              )}

              <button
                type="submit"
                className="u-btn-primary u-press h-10 self-start rounded-lg bg-blue px-5 text-sm font-bold text-white"
              >
                {t('common.actions.save')}
              </button>
            </form>
          )}
        </div>

        <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
          <div>
            <h2 className="u-title-card text-ink">{t('agent.settings.hoursTitle')}</h2>
            <p className="mt-0.5 text-[0.8125rem] text-ink-45">
              {t('agent.settings.hoursHint')}
            </p>
          </div>

          <form action={updateWorkingHoursAction} className="flex flex-col gap-3">
            <input
              type="text"
              name="working_hours"
              defaultValue={agent.working_hours || ''}
              placeholder={t('agent.settings.hoursPlaceholder')}
              maxLength={200}
              className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
            />

            {saved === 'hours' && (
              <p className="text-sm font-semibold text-success" role="status">
                {t('agent.settings.hoursSaved')}
              </p>
            )}

            <button
              type="submit"
              className="u-btn-secondary u-press h-10 self-start rounded-lg px-5 text-sm font-bold text-ink"
            >
              {t('common.actions.save')}
            </button>
          </form>
        </div>
        </div>

        <div className="flex flex-col gap-6">
          <div id="verification" className="u-card flex scroll-mt-24 flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
            <div>
              <h2 className="u-title-card text-ink">{t('agent.verification.title')}</h2>
              <p className="mt-0.5 text-[0.8125rem] text-ink-45">{t('agent.verification.hint')}</p>
            </div>

            {verification ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] font-semibold text-ink-70">
                  <span>
                    {t('agent.verification.levelNow', {
                      level: t(LEVEL_LABEL_KEYS[verification.level] || LEVEL_LABEL_KEYS.standard),
                    })}
                  </span>
                  <AgentVerificationBadge level={verification.level} t={t} />
                </div>
                {verification.level === 'standard' && (
                  <p className="-mt-2 text-xs text-ink-45">{t('agent.verification.levelStandardExplain')}</p>
                )}

                <form action={uploadVerificationDocumentAction} className="flex flex-col gap-3">
                  <div>
                    <label htmlFor="doc_type" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                      {t('agent.verification.docType')}
                    </label>
                    <select
                      id="doc_type"
                      name="doc_type"
                      required
                      defaultValue=""
                      className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                    >
                      <option value="" disabled>{t('common.shared.choose')}</option>
                      {VERIFICATION_DOC_TYPES.map((type) => (
                        <option key={type} value={type}>{t(DOC_TYPE_LABEL_KEYS[type])}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="verification_document" className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                      {t('agent.verification.file')}
                    </label>
                    <input
                      id="verification_document"
                      name="document"
                      type="file"
                      required
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="block w-full max-w-full text-sm text-ink-70 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink"
                    />
                  </div>

                  {saved === 'verification' && (
                    <p className="text-sm font-semibold text-success" role="status">{t('agent.verification.submitted')}</p>
                  )}
                  {verificationError && (
                    <p className="text-sm font-semibold text-danger" role="alert">
                      {t(`agent.verification.errors.${verificationError}`)}
                    </p>
                  )}

                  <button type="submit" className="u-btn-secondary u-press h-11 w-full rounded-lg text-sm font-bold text-ink">
                    {t('agent.verification.submit')}
                  </button>
                  <p className="text-xs text-ink-35">{t('agent.verification.privacy')}</p>
                </form>

                <div className="flex flex-col gap-2">
                  <h3 className="u-title-sub text-ink">{t('agent.verification.documentsTitle')}</h3>
                  {verification.documents.length === 0 ? (
                    <p className="text-[0.8125rem] text-ink-45">{t('agent.verification.noDocuments')}</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {verification.documents.map((doc) => (
                        <li key={doc.id} className="flex flex-col gap-1 rounded-lg border border-line px-3 py-2 text-[0.8125rem]">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-ink">{t(DOC_TYPE_LABEL_KEYS[doc.doc_type] || DOC_TYPE_LABEL_KEYS.other)}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${DOC_STATUS_TONE[doc.status] || DOC_STATUS_TONE.pending}`}>
                              {t(DOC_STATUS_LABEL_KEYS[doc.status] || DOC_STATUS_LABEL_KEYS.pending)}
                            </span>
                          </div>
                          {doc.status === 'rejected' && doc.review_note && (
                            <p className="text-xs text-ink-45">{t('agent.verification.rejectedNote', { note: doc.review_note })}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <p className="text-[0.8125rem] text-ink-45">{t('agent.verification.unavailable')}</p>
            )}
          </div>

          <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
            <h2 className="u-title-card text-ink">{t('agent.settings.passwordTitle')}</h2>

            <form action={changeAgentPasswordAction} className="flex flex-col gap-3">
              {[
                { id: 'current_password', label: t('agent.settings.currentPassword'), autoComplete: 'current-password' },
                { id: 'new_password', label: t('agent.settings.newPassword'), autoComplete: 'new-password', placeholder: t('auth.minEightCharsShort') },
                { id: 'confirm_password', label: 'Confirmer', autoComplete: 'new-password' },
              ].map((field) => (
                <div key={field.id}>
                  <label htmlFor={field.id} className="mb-1.5 block text-[0.8125rem] font-semibold text-ink-70">
                    {field.label}
                  </label>
                  <input
                    id={field.id}
                    name={field.id}
                    type="password"
                    autoComplete={field.autoComplete}
                    placeholder={field.placeholder}
                    required
                    className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
                  />
                </div>
              ))}

              {passwordSuccess && (
                <p className="text-sm font-semibold text-success" role="status">
                  {t('agent.settings.passwordSaved')}
                </p>
              )}
              {error && error !== 'name_required' && (
                <p className="text-sm font-semibold text-danger" role="alert">
                  {t(ERROR_MESSAGE_KEYS[error] || ERROR_MESSAGE_KEYS.wrong_password)}
                </p>
              )}

              <button
                type="submit"
                className="u-btn-secondary u-press mt-1 h-11 w-full rounded-lg text-sm font-bold text-ink"
              >
                {t('agent.settings.updatePassword')}
              </button>
            </form>
          </div>

          <div className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="u-title-card text-ink">{t('agent.settings.publicPageTitle')}</h2>
              <span className="u-tabular text-[0.8125rem] font-bold text-blue">{completion.percent} %</span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-blue" style={{ width: `${completion.percent}%` }} />
            </div>

            <ul className="flex flex-col gap-2 text-[0.8125rem]">
              {completion.items.map((item) => (
                <li key={item.labelKey} className="flex items-center gap-2">
                  {item.done ? (
                    <Check strokeWidth={2.5} className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-25" />
                  )}
                  <span className={item.done ? 'text-ink-45 line-through decoration-ink-25' : 'text-ink-70'}>
                    {t(item.labelKey)}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              href={`/agents/${agent.id}`}
              target="_blank"
              className="u-press inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line text-[0.8125rem] font-bold text-ink transition-colors hover:bg-canvas-alt"
            >
              {t('agent.settings.viewMyPage')}
              <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            </Link>
            <p className="truncate text-xs text-ink-35">{profileUrl}</p>
          </div>
        </div>
      </div>
    </>
  );
}
