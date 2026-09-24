import Link from 'next/link';
import { Phone } from 'lucide-react';
import AgentMonogram from '@/components/AgentMonogram';
import PhoneField from '@/components/PhoneField';
import { submitProjectEnquiryAction } from '@/app/(site)/projets/[slug]/actions';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { phoneFieldLabels } from '@/lib/phoneFieldLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

const ERROR_KEYS = { phone: 'projects.enquiry.errorPhone', 1: 'projects.enquiry.error' };

/**
 * The project page's contact rail.
 *
 * Two routes, like a listing (root CLAUDE.md, "Dual contact policy"):
 *   - the FORM always works: it records a lead in the developer's Demandes
 *     and alerts developer + desk over WhatsApp (services/projectEnquiry.js);
 *   - direct WhatsApp / call buttons appear ONLY for a verified,
 *     routing-enabled developer number (NULL in SQL otherwise,
 *     lib/developments.js). There is deliberately no central-number fallback
 *     here: a pre-typed message about a project reaching the engine's intake
 *     would get the generic model reply the listing-enquiry module exists to
 *     prevent. The form is the fallback.
 *
 * The WhatsApp text is French whatever the UI language — the developer reads it.
 */
export default async function ProjectEnquiryCard({ project, interest, sent, error, idSuffix = '' }) {
  const t = await getT();
  const name = displayableAgencyName(project.agency_name) || project.developer_name || null;
  const phone = String(project.agent_phone || '').replace(/\D/g, '');
  const link = `${SITE_URL}/projets/${project.slug}`;
  const waHref = phone
    ? buildWhatsAppLink(phone, `Bonjour, je vous contacte via Lukka Place au sujet du projet « ${project.name} »${project.commune ? ` (${project.commune})` : ''}.\n\nPouvez-vous m'envoyer plus d'informations ?\n\n${link}`)
    : null;

  const options = [
    ...(project.unit_types || []).map((u) => ({ value: `unit:${u.id}`, label: u.label })),
    ...(project.lots || []).filter((l) => l.status !== 'sold').map((l) => ({ value: `lot:${l.id}`, label: l.share_percent ? `${l.label} (${Number(l.share_percent)}%)` : l.label })),
  ];
  const selected = options.some((o) => o.value === interest) ? interest : '';
  const action = submitProjectEnquiryAction.bind(null, project.id);

  return (
    <div className="u-lift flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <AgentMonogram logoUrl={project.agent_logo} name={name} className="h-12 w-12" textClassName="text-base" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[0.9375rem] font-bold text-ink">{name || 'Lukka Place'}</span>
          <span className="text-[0.8125rem] text-ink-45">{name ? t('projects.enquiry.developer') : t('projects.enquiry.team')}</span>
        </div>
      </div>

      {waHref ? (
        <div className="flex flex-col gap-2">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] px-4 text-sm font-semibold text-white"
          >
            {t('projects.enquiry.whatsapp')}
          </a>
          <a
            href={`tel:+${phone}`}
            className="u-btn-secondary inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-ink"
          >
            <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('projects.enquiry.call')}
          </a>
        </div>
      ) : null}

      <div className="h-px bg-line" />

      {sent ? (
        <div className="rounded-lg bg-success-tint px-3.5 py-3 text-sm text-success" role="status">
          <p className="font-semibold">{t('projects.enquiry.sentTitle')}</p>
          <p className="mt-0.5">{t('projects.enquiry.sentBody')}</p>
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <p className="u-title-sub text-ink">{t('projects.enquiry.formTitle')}</p>
          {error ? (
            <p className="rounded-lg bg-danger-tint px-3 py-2 text-[0.8125rem] font-semibold text-danger" role="alert">
              {t(ERROR_KEYS[error] || ERROR_KEYS[1])}
            </p>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink-70">{t('projects.enquiry.name')}</span>
            <input name="name" autoComplete="name" maxLength={120} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink" />
          </label>
          <PhoneField
            name="phone"
            id={`project-phone${idSuffix}`}
            locale={t.locale}
            labels={{ ...phoneFieldLabels(t), label: t('enquiry.whatsappNumber') }}
            required
          />
          {options.length ? (
            <label className="flex flex-col gap-1">
              <span className="u-micro-strong text-ink-70">{t('projects.enquiry.interest')}</span>
              <select name="interest" defaultValue={selected} className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink">
                <option value="">{t('projects.enquiry.interestGeneral')}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="u-micro-strong text-ink-70">{t('projects.enquiry.message')}</span>
            <textarea name="message" rows={3} maxLength={800} placeholder={t('projects.enquiry.messagePlaceholder')} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
          </label>
          <button type="submit" className="u-btn-primary inline-flex min-h-11 items-center justify-center rounded-full bg-blue px-4 text-sm font-semibold text-white">
            {t('projects.enquiry.submit')}
          </button>
          <p className="text-[0.75rem] leading-relaxed text-ink-45">{t('projects.enquiry.privacy')}</p>
        </form>
      )}

      {project.agent_id ? (
        <Link href={`/agents/${project.agent_id}`} className="text-center text-[0.8125rem] font-semibold text-blue-deep hover:underline">
          {t('projects.enquiry.developerProfile')}
        </Link>
      ) : null}
    </div>
  );
}
