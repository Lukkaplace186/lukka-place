import { redirect } from 'next/navigation';
import { LogOut, ShieldCheck } from 'lucide-react';
import CurrencyToggle from '@/components/CurrencyToggle';
import { PortalPanel, PortalSectionHeading } from '@/components/ClientPortalUI';
import DeleteAccountButton from '../../DeleteAccountButton';
import { getPortalCustomer } from '@/lib/customerPortal';
import { getCdfRate } from '@/lib/currencyRate';
import { formatPhoneDisplay } from '@/lib/phone';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { logoutAction, deleteAccountAction } from '../../actions';
import { updateProfileNameAction } from '../actions';

export const metadata = {
  title: 'Paramètres — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * "Paramètres" — the design's settings screen, reduced to the fields this
 * schema genuinely has.
 *
 * `customers` holds exactly: phone, password hash, full name, and the
 * session/lockout bookkeeping. So the design's "Adresse e-mail" and
 * "Langue" fields are deliberately absent — there is no column behind
 * either, and a field that silently discards what you typed is worse than
 * no field at all. Its "Identité vérifiée" panel is likewise not
 * reproduced: no ID-verification state exists on this table. What replaces
 * it is the one real security fact — the account is tied to a verified
 * phone number, which is also the only channel a password reset can go
 * through.
 *
 * The contact-preference switches are absent for the same reason as on the
 * Alertes tab: nothing stores them, and nothing acts on them.
 */
export default async function ParametresPage() {
  const session = await getPortalCustomer();
  if (!session) redirect('/compte/connexion?next=/compte/client/parametres');

  const { customer } = session;
  const rate = await getCdfRate();

  const memberSince = customer.created_at ? DATE_FORMATTER.format(new Date(customer.created_at)) : null;

  // Same reasoning as /compte: there is no self-service password reset flow
  // that can be built honestly here (no email, and a proactive WhatsApp push
  // hits the Meta template wall), so this routes to the one real channel.
  const passwordHelpHref = getCentralWhatsAppHref(
    `Bonjour, j'ai besoin d'aide avec le mot de passe de mon compte Lukka Place (${formatPhoneDisplay(customer.phone)}).`,
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start">
      <div className="flex flex-col gap-6">
        <PortalSectionHeading
          title="Paramètres"
          lead="Vos informations et vos préférences d'affichage."
        />

        <PortalPanel className="p-6 sm:p-7">
          <h3 className="text-[1.125rem] font-bold text-ink">Informations personnelles</h3>

          <form action={updateProfileNameAction} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fullName" className="u-eyebrow mb-1.5 block">
                Nom complet
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                defaultValue={customer.full_name || ''}
                placeholder="Votre nom"
                className="u-focus-ring w-full rounded-md border border-line bg-white px-3.5 py-2.5 text-[0.9375rem] text-ink placeholder:text-ink-25"
              />
            </div>

            <div>
              <label htmlFor="phone" className="u-eyebrow mb-1.5 block">
                Téléphone (WhatsApp)
              </label>
              <input
                id="phone"
                type="tel"
                value={formatPhoneDisplay(customer.phone)}
                readOnly
                aria-describedby="phone-help"
                className="u-tabular w-full cursor-not-allowed rounded-md border border-line bg-canvas-alt px-3.5 py-2.5 text-[0.9375rem] text-ink-45"
              />
              <p id="phone-help" className="mt-1.5 text-[0.75rem] text-ink-35">
                C&apos;est l&apos;identifiant de votre compte : il ne peut pas être modifié ici.
              </p>
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="u-btn-primary inline-flex items-center rounded-full bg-blue px-6 py-2.5 text-[0.875rem] font-semibold text-white"
              >
                Enregistrer les modifications
              </button>
            </div>
          </form>

          {memberSince ? (
            <p className="mt-5 border-t border-line pt-4 text-[0.8125rem] text-ink-35">
              Membre depuis le {memberSince}
            </p>
          ) : null}
        </PortalPanel>

        <PortalPanel className="p-6 sm:p-7">
          <h3 className="text-[1.125rem] font-bold text-ink">Devise d&apos;affichage</h3>
          <p className="mt-2 max-w-lg text-[0.8125rem] leading-[1.5] text-ink-45">
            Les prix sont enregistrés en dollars. L&apos;affichage en francs congolais utilise un taux indicatif de{' '}
            <span className="u-tabular font-semibold text-ink-70">
              {rate.cdfPerUsd.toLocaleString('fr-FR')} FC pour 1 USD
            </span>
            , mis à jour le {rate.updatedAt} — ce n&apos;est pas un taux en temps réel.
          </p>
          <div className="mt-4">
            <CurrencyToggle longLabels />
          </div>
        </PortalPanel>
      </div>

      <aside className="flex flex-col gap-5">
        <PortalPanel className="p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
            <ShieldCheck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-3.5 text-[1.0625rem] font-bold text-ink">Sécurité du compte</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.55] text-ink-45">
            Votre compte est rattaché au numéro {formatPhoneDisplay(customer.phone)}. C&apos;est par ce numéro que
            passe toute réinitialisation de mot de passe.
          </p>
          {passwordHelpHref ? (
            <a
              href={passwordHelpHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3.5 inline-block text-[0.8125rem] font-semibold text-blue-deep hover:underline"
            >
              Mot de passe oublié ?
            </a>
          ) : null}
        </PortalPanel>

        <PortalPanel className="p-6">
          <h3 className="text-[1.0625rem] font-bold text-ink">Session</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.55] text-ink-45">
            Se déconnecter met fin à toutes vos sessions ouvertes, sur cet appareil comme sur les autres.
          </p>
          <form action={logoutAction} className="mt-4">
            <button
              type="submit"
              className="u-btn-secondary inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[0.875rem] font-semibold text-ink"
            >
              <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              Se déconnecter
            </button>
          </form>
        </PortalPanel>

        <PortalPanel className="p-6">
          <h3 className="text-[1.0625rem] font-bold text-ink">Fermer le compte</h3>
          <p className="mt-2 text-[0.8125rem] leading-[1.55] text-ink-45">
            Vos favoris et vos recherches sauvegardées seront supprimés définitivement.
          </p>
          <div className="mt-4">
            <DeleteAccountButton action={deleteAccountAction} />
          </div>
        </PortalPanel>
      </aside>
    </div>
  );
}
