import Link from 'next/link';
import { getT } from '@/lib/i18n/server';

/**
 * Help, the privacy policy and the terms, as three quiet links at the very
 * bottom of the app's two Compte screens (2026-11-14, store submission).
 *
 * In the app the website's footer is replaced by the tab bar, so without
 * these nobody could reach the policy from inside it, and both stores check
 * that they can. Kept small on purpose (owner: "somewhere hidden"): present
 * for whoever looks, never in the way. Each link is still a 44px target.
 */
const LINKS = [
  { key: 'help', href: '/contact' },
  { key: 'privacy', href: '/confidentialite' },
  { key: 'terms', href: '/conditions' },
];

export default async function AppLegalLinks() {
  const t = await getT();
  return (
    <nav aria-label={t('appShell.legal.label')} className="flex flex-wrap items-center justify-center gap-x-6">
      {LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className="inline-flex min-h-11 items-center text-[0.8125rem] text-ink-45 underline-offset-2 active:text-ink hover:underline"
        >
          {t(`appShell.legal.${link.key}`)}
        </Link>
      ))}
    </nav>
  );
}
