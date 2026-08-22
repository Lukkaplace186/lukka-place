import { ShieldCheck, Users, MessageCircle } from 'lucide-react';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const TRUST_POINTS = [
  { icon: ShieldCheck, text: 'Chaque annonce est vérifiée avant publication' },
  { icon: Users, text: 'Une équipe réelle, basée à Kinshasa' },
  { icon: MessageCircle, text: 'Un seul canal WhatsApp, pas de démarchage' },
];

/**
 * Closing trust band.
 *
 * Deliberately one generic "the Lukka Place team" block rather than
 * per-listing agent profiles: no agent entity exists anywhere in the schema,
 * and every listing already routes through this one central number by design
 * (CLAUDE.md's Lead Routing Rules). Inventing agent names, photos or ratings
 * to fill the space the reference portals give them is exactly what the
 * no-fabricated-data rule forbids.
 */
export default function TrustSection() {
  const phoneNumber = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const whatsappHref = phoneNumber
    ? buildWhatsAppLink(phoneNumber, "Bonjour, j'ai une question pour l'équipe Lukka Place.")
    : null;

  return (
    <section className="mx-auto max-w-[1600px] px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <div className="flex flex-col gap-10 rounded-lg border border-line bg-surface px-6 py-10 sm:px-10 sm:py-12 lg:flex-row lg:items-center lg:gap-16 lg:px-14">
        <div className="flex-1">
          <p className="u-eyebrow mb-4">Qui est derrière</p>
          <h2 className="font-display text-[1.75rem] font-normal leading-[1.12] tracking-[-0.02em] text-ink sm:text-[2.25rem]">
            Une seule équipe, un seul numéro
          </h2>
          <p className="mt-4 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-45">
            Chaque annonce passe par une vraie équipe avant d&apos;être publiée — pas d&apos;agents multiples à démêler,
            pas de fiches abandonnées. Une seule ligne WhatsApp pour une question, une visite ou un signalement.
          </p>

          <ul className="mt-7 grid gap-3 sm:grid-cols-3">
            {TRUST_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5 text-[0.8125rem] leading-snug text-ink-70">
                <Icon strokeWidth={ICON_STROKE_WIDTH} className="mt-px h-4 w-4 shrink-0 text-blue-deep" />
                {text}
              </li>
            ))}
          </ul>
        </div>

        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-green px-7 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-deep"
          >
            Discuter avec l&apos;équipe
          </a>
        ) : null}
      </div>
    </section>
  );
}
