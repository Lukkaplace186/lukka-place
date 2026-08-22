import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart, Bookmark, LogOut } from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import { getCurrentCustomerId, getCustomerById, listFavoriteIds, listSavedSearches } from '@/lib/customers';
import { getListingsByIds } from '@/lib/listings';
import { formatPhoneDisplay } from '@/lib/phone';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { logoutAction, updateNameAction, deleteAccountAction } from './actions';
import DeleteAccountButton from './DeleteAccountButton';

export const metadata = {
  title: 'Mon compte — Lukka Place',
  robots: { index: false, follow: false },
};

const DATE_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export default async function AccountPage() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) redirect('/compte/connexion?next=/compte');

  const customer = await getCustomerById(customerId);
  if (!customer) redirect('/compte/connexion');

  const [favoriteIds, savedSearches] = await Promise.all([
    listFavoriteIds(customerId),
    listSavedSearches(customerId),
  ]);
  const previewFavorites = favoriteIds.length > 0 ? await getListingsByIds(favoriteIds.slice(0, 3)) : [];

  // No self-service password reset — there's no re-verification channel to
  // build one honestly (no email, and a proactive WhatsApp push hits the
  // same Meta template-approval wall documented in the plan). This reuses
  // the one real contact channel every other CTA in this app already uses.
  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const forgotPasswordHref = phoneNumber
    ? buildWhatsAppLink(phoneNumber, `Bonjour, j'ai oublié le mot de passe de mon compte Lukka Place (${formatPhoneDisplay(customer.phone)}).`)
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Breadcrumb className="mb-6" items={[{ label: 'Accueil', href: '/' }, { label: 'Mon compte' }]} />

      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[2rem] font-normal leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.5rem]">
            Mon compte
          </h1>
          <p className="mt-3 text-[0.9375rem] text-ink-45">{formatPhoneDisplay(customer.phone)}</p>
          <p className="mt-1 text-[0.8125rem] text-ink-45">Membre depuis le {DATE_FORMATTER.format(new Date(customer.created_at))}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-[0.8125rem] font-semibold text-ink-70 transition-colors hover:bg-canvas-alt"
          >
            <LogOut strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            Se déconnecter
          </button>
        </form>
      </header>

      <section className="mb-8 rounded-lg border border-line bg-surface p-5">
        <h2 className="u-eyebrow mb-3">Profil</h2>
        <form action={updateNameAction} className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-0 flex-1">
            <label htmlFor="fullName" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              Nom
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              defaultValue={customer.full_name || ''}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
          >
            Enregistrer
          </button>
        </form>
        {forgotPasswordHref && (
          <a href={forgotPasswordHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[0.8125rem] font-medium text-blue-deep hover:underline">
            Mot de passe oublié ?
          </a>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/favoris" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-ink-25">
          <span className="flex items-center gap-2 text-ink-70">
            <Heart strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            <span className="u-eyebrow">Favoris</span>
          </span>
          <p className="u-tabular text-2xl font-bold text-ink">{favoriteIds.length}</p>
          {previewFavorites.length > 0 && (
            <p className="truncate text-[0.8125rem] text-ink-45">
              {previewFavorites.map((l) => l.title).join(' · ')}
            </p>
          )}
        </Link>

        <Link href="/compte/alertes" className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-ink-25">
          <span className="flex items-center gap-2 text-ink-70">
            <Bookmark strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            <span className="u-eyebrow">Recherches sauvegardées</span>
          </span>
          <p className="u-tabular text-2xl font-bold text-ink">{savedSearches.length}</p>
          {savedSearches.length > 0 && (
            <p className="truncate text-[0.8125rem] text-ink-45">
              {savedSearches.map((s) => s.label).join(' · ')}
            </p>
          )}
        </Link>
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <DeleteAccountButton action={deleteAccountAction} />
      </section>
    </div>
  );
}
