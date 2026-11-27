import { Plus } from 'lucide-react';
import { WhatsAppIcon } from '@/components/WhatsAppCTA';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { formatPhoneDisplay } from '@/lib/phone';

/**
 * "Ajouter un bien" in the store app (owner decision 2026-11-26): an agent
 * publishes by sending the listing on WhatsApp to our intake number, never
 * through the website's form (CreateListingDialog stays on the website).
 * The chat opens with no text: whatever the agent writes is read as the
 * listing, so we put nothing in their mouth.
 *
 * - `variant="icon"`: the overview header's "+", same size as the website's.
 * - `variant="card"`: the explanation and the button, above Mes biens.
 *
 * No number configured (NEXT_PUBLIC_WHATSAPP_NUMBER) means no link: the card
 * says so and the icon is not drawn, never a wa.me link to nowhere.
 */
export default async function AppAddListingWhatsApp({ variant = 'card' }) {
  const t = await getT();
  // Our intake number (the central one). Built here rather than with
  // lib/whatsapp.js buildWhatsAppLink, which always adds ?text= — an empty
  // chat is the point (see above).
  const number = String(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, '');
  const href = number ? `https://wa.me/${number}` : null;

  if (variant === 'icon') {
    if (!href) return null;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('agent.appAdd.title')}
        className="u-press u-focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue text-white"
      >
        <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
      </a>
    );
  }

  return (
    <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-green-tint text-green-ink">
          <WhatsAppIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="u-title-card">{t('agent.appAdd.title')}</h2>
          <p className="u-micro mt-0.5">
            {href
              ? t('agent.appAdd.body', { number: formatPhoneDisplay(number) || `+${number}` })
              : t('agent.appAdd.unavailable')}
          </p>
        </div>
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="u-press u-focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-green px-4 text-[0.9375rem] font-semibold text-white"
        >
          <WhatsAppIcon className="h-5 w-5" />
          {t('agent.appAdd.cta')}
        </a>
      ) : null}
    </section>
  );
}
