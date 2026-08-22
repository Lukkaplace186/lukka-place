import Link from 'next/link';
import { signupAction } from './actions';
import SignupForm from './SignupForm';

export const metadata = {
  title: 'Créer un compte — Lukka Place',
  robots: { index: false, follow: false },
};

export default async function CustomerSignupPage({ searchParams }) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const next = typeof params.next === 'string' ? params.next : '/compte';

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-normal tracking-[-0.01em] text-ink">Créer un compte</h1>
        <p className="mt-1 text-sm text-ink-45">
          Vos favoris et recherches déjà enregistrés sur cet appareil seront conservés.
        </p>

        <SignupForm action={signupAction} next={next} error={error} />

        <p className="mt-5 text-center text-sm text-ink-45">
          Déjà un compte ?{' '}
          <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );
}
