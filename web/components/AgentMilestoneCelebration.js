'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import Confetti from './Confetti';
import { milestoneToCelebrate } from '@/lib/agentMilestoneRules';

/**
 * "🎉 Votre première demande de visite !" (2026-11-03) — a short confetti
 * moment on the agent overview the first time one of their firsts happens
 * (lib/agentMilestones.js reads when it did).
 *
 * Celebrated once per device: the keys already shown are kept in
 * localStorage per agent. Only a first reached in the last RECENT_DAYS is
 * celebrated, so an agent who passed it months ago is not congratulated
 * today; with several new ones the most important (a deal over a visit over
 * a tap over a view) is shown and the others are marked seen, so an agent
 * is never handed a queue of popups. Confetti is CSS (.u-confetti) and off
 * under reduced motion.
 */
const LINKS = {
  firstDeal: '/compte/agent/biens?status=closed',
  firstVisit: '/compte/agent/demandes?filtre=a-traiter',
  firstTap: '/compte/agent/biens',
  firstView: '/compte/agent/biens',
};

function storageKey(agentId) {
  return `lp_agent_milestones_${agentId}`;
}

function readSeen(agentId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(agentId)) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeSeen(agentId, keys) {
  try {
    window.localStorage.setItem(storageKey(agentId), JSON.stringify([...keys]));
  } catch {
    // Blocked storage: the card may show again next visit, nothing worse.
  }
}


export default function AgentMilestoneCelebration({ agentId, milestones }) {
  const t = useT();
  const [shown, setShown] = useState(null);

  useEffect(() => {
    if (!agentId || !milestones?.length) return;
    const seen = readSeen(agentId);
    const pick = milestoneToCelebrate(milestones, seen);
    // Everything reached so far is seen from now on, celebrated or not.
    writeSeen(agentId, new Set([...seen, ...milestones.map((m) => m.key)]));
    // Decided from this device's storage, which only exists after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only signal, read once
    if (pick) setShown(pick.key);
  }, [agentId, milestones]);

  if (!shown) return null;

  return (
    <section
      role="status"
      className="u-reveal relative overflow-hidden rounded-card bg-gradient-to-br from-blue to-blue-deep px-5 py-5 text-white shadow-[var(--shadow-card)]"
    >
      <Confetti />
      <button
        type="button"
        onClick={() => setShown(null)}
        aria-label={t('agent.milestones.dismiss')}
        className="u-hit absolute right-3 top-3 rounded-full p-1 text-white/80 hover:text-white"
      >
        <X strokeWidth={2} className="h-4 w-4" />
      </button>
      <p className="pr-6 text-[1.0625rem] font-extrabold leading-snug">{t(`agent.milestones.${shown}.title`)}</p>
      <p className="mt-1 max-w-prose text-[0.875rem] leading-snug text-white/85">{t(`agent.milestones.${shown}.body`)}</p>
      <Link
        href={LINKS[shown]}
        className="u-press mt-3 inline-flex min-h-10 items-center rounded-full bg-white px-4 text-[0.8125rem] font-bold text-blue-deep"
      >
        {t(`agent.milestones.${shown}.cta`)}
      </Link>
    </section>
  );
}
