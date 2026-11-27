'use client';

import { useState, useTransition } from 'react';
import { CalendarCheck, Phone } from 'lucide-react';
import { contactOutcomeAction } from '@/app/(site)/point/actions';
import { CONTACT_OUTCOMES, CONTACT_OUTCOME_LABELS_FR } from '@/lib/contactOutcomeRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const CHIP = 'u-press inline-flex min-h-10 items-center justify-center rounded-full border px-3 text-[0.8125rem] font-semibold disabled:opacity-60';

/**
 * « Vos contacts de la semaine » under "Faites le point" (2026-11-20): each
 * customer who tapped the agent's buttons in the last 7 days, and one tap to
 * say what came of it (lib/contactOutcomeRules.js). The answer can change
 * through the week; the latest stands. French only, like the page.
 *
 * @param {{token: string|null, items: Object[], unavailable?: boolean}} props
 */
export default function ContactOutcomes({ token = null, items = [], unavailable = false }) {
  const [outcomes, setOutcomes] = useState(() => Object.fromEntries(items.map((item) => [item.id, item.outcome])));
  const [errors, setErrors] = useState({});
  const [pendingId, setPendingId] = useState(null);
  const [, startTransition] = useTransition();

  if (unavailable) {
    return (
      <section className="mt-8 rounded-card border border-line bg-surface p-4">
        <h2 className="u-title-card text-ink">Vos contacts de la semaine</h2>
        <p className="u-micro mt-1 text-ink-70">Indisponible pour le moment. Réessayez plus tard.</p>
      </section>
    );
  }
  if (!items.length) return null;

  function choose(item, outcome) {
    setErrors((prev) => ({ ...prev, [item.id]: null }));
    setPendingId(item.id);
    startTransition(async () => {
      try {
        const result = await contactOutcomeAction(token, item.id, outcome);
        if (result?.ok) setOutcomes((prev) => ({ ...prev, [item.id]: outcome }));
        else setErrors((prev) => ({ ...prev, [item.id]: result?.error || 'Une erreur est survenue. Réessayez.' }));
      } catch {
        setErrors((prev) => ({ ...prev, [item.id]: 'Connexion perdue. Réessayez.' }));
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <section className="mt-8 flex flex-col gap-3" aria-labelledby="contacts-semaine">
      <header>
        <h2 id="contacts-semaine" className="u-title-section text-ink">Vos contacts de la semaine</h2>
        <p className="u-micro mt-1 text-ink-70">
          Les clients qui ont appuyé sur WhatsApp ou Appeler sur vos annonces. Dites-nous où vous en êtes : une visite prévue apparaît dans vos visites, et nous vous demanderons ensuite si elle a eu lieu.
        </p>
      </header>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => {
          const current = outcomes[item.id] || null;
          return (
            <li key={item.id} className="rounded-card border border-line bg-surface p-3.5">
              <p className="u-micro text-ink-45">{item.when}</p>
              <p className="u-title-sub mt-0.5 text-ink">{item.listingTitle}</p>
              <p className="u-micro mt-0.5 text-ink-70">{item.what}{item.saidNothing ? ' · vous avez dit n’avoir rien reçu' : ''}</p>
              {item.customer ? (
                <a href={`https://wa.me/${item.customerPhone}`} target="_blank" rel="noopener noreferrer" className="u-micro-strong mt-1 inline-flex items-center gap-1 text-blue-deep">
                  <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                  {item.customer}
                </a>
              ) : null}
              <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Où en êtes-vous ?">
                {CONTACT_OUTCOMES.map((outcome) => {
                  const active = current === outcome;
                  return (
                    <button
                      key={outcome}
                      type="button"
                      disabled={pendingId === item.id}
                      aria-pressed={active}
                      onClick={() => choose(item, outcome)}
                      className={`${CHIP} ${active ? 'border-blue bg-blue text-white' : 'border-line bg-surface text-ink hover:border-blue'}`}
                    >
                      {CONTACT_OUTCOME_LABELS_FR[outcome]}
                    </button>
                  );
                })}
              </div>
              {current === 'VISIT_PLANNED' || current === 'VISITED' ? (
                <p className="u-micro mt-2 inline-flex items-center gap-1 text-success">
                  <CalendarCheck strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
                  {current === 'VISIT_PLANNED' ? 'Ajoutée à vos visites : fixez l’heure dans l’onglet Visites.' : 'Visite enregistrée. Merci !'}
                </p>
              ) : null}
              {current === 'CLOSED' ? (
                <p className="u-micro mt-2 text-ink-70">Marquez aussi l’annonce « Loué / Vendu » ci-dessus pour la retirer du site.</p>
              ) : null}
              {errors[item.id] ? <p className="u-micro mt-1 text-danger" role="alert">{errors[item.id]}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
