'use client';

import { useEffect, useState } from 'react';
import AppAvatar from '@/components/app/AppAvatar';

const PHONE = { width: 375, height: 812 };
const SCALES = [0.5, 0.65, 0.8, 1];

/**
 * The /app-demo board (local only, see page.js): one phone frame per screen.
 * Sets the app-mode cookie first (the same `lp_app` /app sets), so every frame
 * draws the app, not the website. "Tout recharger" remounts every frame.
 */
export default function AppDemoBoard({ groups, showcase = null }) {
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(0.65);
  const [round, setRound] = useState(0);

  useEffect(() => {
    // httpOnly when /app set it, so this write is ignored then — it is 1 already.
    document.cookie = 'lp_app=1; path=/; max-age=31536000; samesite=lax';
    setReady(true);
  }, []);

  return (
    <div className="min-h-screen bg-[#e9ebf0] px-6 py-6 text-ink">
      <div className="mx-auto mb-6 flex max-w-[1800px] flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[1.5rem] font-extrabold">Lukka Place — démo de l’app</p>
          <p className="mt-1 max-w-3xl text-[0.875rem] text-ink-70">
            Chaque cadre est la vraie page en mode app, sur les vraies données, et se met à jour tout seul quand le code change.
            Les écrans agents et Notifications demandent une connexion : connectez-vous dans un cadre, les autres suivent.
          </p>
          <p className="mt-1 max-w-3xl text-[0.875rem] font-semibold text-danger">
            Vraies données : n’envoyez pas de demande de visite ni de message depuis cette page, ils partent pour de vrai.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[0.875rem] font-semibold">
            Taille{' '}
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))} className="ml-1 rounded-lg border border-line bg-surface px-2 py-1.5">
              {SCALES.map((s) => (
                <option key={s} value={s}>{Math.round(s * 100)} %</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setRound((n) => n + 1)} className="rounded-lg bg-blue px-3 py-2 text-[0.875rem] font-semibold text-white">
            Tout recharger
          </button>
        </div>
      </div>

      {/* Building blocks, each variant side by side (no session needed to see them). */}
      <section className="mx-auto mb-10 max-w-[1800px]">
        <p className="mb-3 text-[1.125rem] font-bold">Composants · Avatar</p>
        <div className="flex flex-wrap items-end gap-8 rounded-2xl bg-canvas-alt p-6">
          {[
            { label: 'Initiales', props: { name: 'Amara Okafor' } },
            { label: 'Un seul mot', props: { name: 'Exemple' } },
            { label: 'Sans nom', props: { name: '' } },
            { label: 'Agent vérifié', props: { name: 'Agence Exemple', verified: true, verifiedLabel: 'Agent vérifié' } },
            { label: 'Photo introuvable', props: { name: 'Marie Nsumbu', src: 'https://lukkaplace.com/introuvable.png' } },
            { label: 'Petit (md)', props: { name: 'Amara Okafor', size: 'md', verified: true, verifiedLabel: 'Agent vérifié' } },
          ].map(({ label, props }) => (
            <figure key={label} className="flex flex-col items-center gap-2">
              <AppAvatar {...props} />
              <figcaption className="text-[0.75rem] text-ink-70">{label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {showcase ? (
        <section className="mx-auto mb-10 max-w-[1800px]">
          <p className="mb-3 text-[1.125rem] font-bold">Composants</p>
          {showcase}
        </section>
      ) : null}

      {groups.map((group) => (
        <section key={group.title} className="mx-auto mb-10 max-w-[1800px]">
          <p className="mb-3 text-[1.125rem] font-bold">{group.title}</p>
          <div className="flex flex-wrap gap-6">
            {group.screens.map((screen) => (
              <figure key={screen.href} className="flex flex-col gap-2">
                <figcaption className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                  <span className="font-semibold">{screen.label}</span>
                  <a href={screen.href} target="_blank" rel="noreferrer" className="text-blue underline-offset-2 hover:underline">
                    ouvrir ↗
                  </a>
                </figcaption>
                <div
                  className="overflow-hidden rounded-[1.75rem] border-[6px] border-ink bg-surface shadow-lg"
                  style={{ width: PHONE.width * scale + 12, height: PHONE.height * scale + 12 }}
                >
                  {ready ? (
                    <iframe
                      key={`${screen.href}-${round}`}
                      src={screen.href}
                      title={screen.label}
                      style={{ width: PHONE.width, height: PHONE.height, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0' }}
                    />
                  ) : null}
                </div>
                {screen.needs ? (
                  <span className="text-[0.75rem] text-ink-45">
                    {screen.needs === 'agent' ? 'Demande une connexion agent' : 'Demande une connexion client'}
                  </span>
                ) : null}
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
