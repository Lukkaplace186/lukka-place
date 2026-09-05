import Link from 'next/link';
import { AlertTriangle, Radar } from 'lucide-react';
import { getMatchingStats } from '@/lib/adminApi';
import { getAgents } from '@/lib/agents';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

export const metadata = {
  title: 'Attribution — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const RANGES = [
  { days: 7, label: '7 jours' },
  { days: 30, label: '30 jours' },
  { days: 90, label: '90 jours' },
];

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

function Stat({ label, value, hint, tone }) {
  return (
    <div className="u-card rounded-card bg-surface p-4">
      <div className="u-eyebrow text-ink-45">{label}</div>
      <div className={`u-stat mt-1.5 ${tone || 'text-ink'}`}>{value}</div>
      {hint ? <div className="u-micro mt-1 text-ink-45">{hint}</div> : null}
    </div>
  );
}

function Panel({ title, note, children, isEmpty, emptyText }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="u-title-card text-ink">{title}</h2>
        {note ? <p className="u-micro mt-0.5 text-ink-45">{note}</p> : null}
      </div>
      {isEmpty ? (
        <div className="rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center">
          <p className="u-micro text-ink-45">{emptyText}</p>
        </div>
      ) : (
        <div className="u-card overflow-x-auto rounded-card bg-surface">{children}</div>
      )}
    </section>
  );
}

const TH = 'px-4 py-2.5 text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-35';
const TD = 'u-micro px-4 py-2.5 text-ink-70';

/**
 * The matching console — how the automated agent push is actually performing.
 *
 * The number this page exists for is "demandes sans agence", the coverage
 * gap: customer requests in a commune where no registered agency has signed
 * up to take work. That is the only figure that tells you where to go
 * recruit, and nothing surfaced it before — an unmatched request simply sat
 * in the leads list looking identical to a matched one.
 *
 * Every figure is a real count from `lead_matches` and `lead_proposals` (the
 * engine's own tables — see services/leadDispatch.js). "Taux de réponse" is
 * pushes that produced a real proposal from the same agency, not an estimate,
 * and a window with no pushes shows zeros rather than a projection.
 *
 * The engine being unreachable renders an honest error rather than taking the
 * console down — the same degrade-don't-die contract every other
 * engine-backed page here follows.
 */
export default async function AdminMatchingPage({ searchParams }) {
  const params = await searchParams;
  const days = RANGES.some((r) => r.days === Number(params.days)) ? Number(params.days) : 30;

  let stats = null;
  let error = null;
  try {
    stats = await getMatchingStats({ days });
  } catch (err) {
    error = err.message;
  }

  const agents = await getAgents().catch(() => []);
  const agentById = new Map(agents.map((a) => [Number(a.id), a]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">Attribution automatique</h1>
          <p className="u-micro mt-1 text-ink-45">
            Chaque demande client est classée puis poussée aux 7 meilleures agences de sa commune, sur
            WhatsApp, à la seconde où elle est soumise.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {RANGES.map((r) => (
            <Link
              key={r.days}
              href={`/admin/matching?days=${r.days}`}
              aria-current={r.days === days ? 'page' : undefined}
              className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${
                r.days === days ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-card border border-danger/40 bg-danger-tint p-5">
          <p className="u-micro-strong text-danger">Le moteur d’attribution est injoignable.</p>
          <p className="u-micro mt-1 text-ink-70">{error}</p>
        </div>
      ) : (
        <>
          {(() => {
            const t = stats.totals;
            const undispatched = Math.max(0, t.leads - t.leads_dispatched);
            const responseRate = pct(t.proposals, t.pushes);
            return (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Demandes reçues" value={t.leads} hint={`sur ${days} jours`} />
                  <Stat
                    label="Demandes attribuées"
                    value={t.leads_dispatched}
                    hint={
                      t.leads
                        ? `${pct(t.leads_dispatched, t.leads)}% des demandes ont trouvé au moins une agence`
                        : null
                    }
                  />
                  <Stat
                    label="Alertes agents envoyées"
                    value={t.pushes}
                    hint={t.failed_pushes ? `${t.failed_pushes} envoi(s) en échec` : 'aucun échec d’envoi'}
                    tone={t.failed_pushes ? 'text-warning' : undefined}
                  />
                  <Stat
                    label="Taux de réponse"
                    value={responseRate == null ? '—' : `${responseRate}%`}
                    hint={`${t.proposals} bien(s) proposé(s) en retour`}
                  />
                </div>

                {undispatched > 0 && (
                  <div className="rounded-card border border-warning/40 bg-warning-tint p-5">
                    <div className="flex items-center gap-2">
                      <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-warning" />
                      <h2 className="u-title-card text-warning">
                        {undispatched} demande{undispatched === 1 ? '' : 's'} sans aucune agence
                      </h2>
                    </div>
                    <p className="u-micro mt-1.5 text-ink-70">
                      Ces clients ont décrit ce qu’ils cherchent et personne n’a été notifié — aucune agence
                      inscrite ne couvre leur commune, ou la demande n’en précisait aucune. C’est la seule
                      métrique de cette page qui indique où recruter.
                    </p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {stats.uncovered.map((row) => (
                        <li
                          key={row.commune}
                          className="u-micro-strong rounded-full bg-surface px-3 py-1 text-ink"
                        >
                          {row.commune} · {row.n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          })()}

          <Panel
            title="Par commune"
            note="Volume de demandes, alertes envoyées et réponses reçues."
            isEmpty={stats.byCommune.length === 0}
            emptyText={`Aucune demande client sur les ${days} derniers jours.`}
          >
            <table className="w-full min-w-[36rem] border-collapse">
              <thead className="bg-canvas-alt">
                <tr>
                  <th className={TH}>Commune</th>
                  <th className={TH}>Demandes</th>
                  <th className={TH}>Alertes envoyées</th>
                  <th className={TH}>Réponses</th>
                  <th className={TH}>Couverture</th>
                </tr>
              </thead>
              <tbody>
                {stats.byCommune.map((row) => {
                  const uncovered = row.pushes === 0;
                  return (
                    <tr key={row.commune} className="border-t border-line">
                      <td className={`${TD} font-semibold text-ink`}>{row.commune}</td>
                      <td className={`${TD} u-tabular`}>{row.leads}</td>
                      <td className={`${TD} u-tabular`}>{row.pushes}</td>
                      <td className={`${TD} u-tabular`}>{row.answers}</td>
                      <td className={TD}>
                        {uncovered ? (
                          <span className="rounded-full bg-danger-tint px-2 py-0.5 text-[0.6875rem] font-bold text-danger">
                            Aucune agence
                          </span>
                        ) : (
                          <span className="rounded-full bg-success-tint px-2 py-0.5 text-[0.6875rem] font-bold text-success">
                            Couverte
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <Panel
            title="Réactivité des agences"
            note="Combien de demandes chaque agence a reçues, et combien elle a réellement traitées. Ce taux pondère son classement dans les attributions suivantes."
            isEmpty={stats.byAgent.length === 0}
            emptyText="Aucune alerte envoyée sur cette période."
          >
            <table className="w-full min-w-[36rem] border-collapse">
              <thead className="bg-canvas-alt">
                <tr>
                  <th className={TH}>Agence</th>
                  <th className={TH}>Alertes reçues</th>
                  <th className={TH}>Réponses</th>
                  <th className={TH}>Taux</th>
                  <th className={TH}>Meilleur rang</th>
                </tr>
              </thead>
              <tbody>
                {stats.byAgent.map((row) => {
                  const agent = agentById.get(Number(row.agent_id));
                  const name =
                    [agent?.first_name, agent?.last_name].filter(Boolean).join(' ') ||
                    agent?.username ||
                    `Agent #${row.agent_id}`;
                  const rate = pct(row.answers, row.pushes);
                  return (
                    <tr key={row.agent_id} className="border-t border-line">
                      <td className={TD}>
                        <Link
                          href={`/admin/agents/${row.agent_id}`}
                          className="font-semibold text-ink hover:text-blue-deep hover:underline"
                        >
                          {name}
                        </Link>
                        <div className="u-micro u-tabular text-ink-35">{row.agent_phone || '—'}</div>
                      </td>
                      <td className={`${TD} u-tabular`}>{row.pushes}</td>
                      <td className={`${TD} u-tabular`}>{row.answers}</td>
                      <td className={TD}>
                        <span
                          className={`u-tabular rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${
                            rate == null
                              ? 'bg-canvas-deep text-ink-45'
                              : rate >= 50
                                ? 'bg-success-tint text-success'
                                : rate > 0
                                  ? 'bg-warning-tint text-warning'
                                  : 'bg-danger-tint text-danger'
                          }`}
                        >
                          {rate == null ? '—' : `${rate}%`}
                        </span>
                      </td>
                      <td className={`${TD} u-tabular`}>{row.best_rank ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <div className="u-card flex items-start gap-3 rounded-card bg-surface p-5">
            <Radar strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
            <div className="u-micro leading-relaxed text-ink-70">
              <p className="font-bold text-ink">Comment le classement fonctionne</p>
              <p className="mt-1">
                Chaque agence est notée sur sa couverture de la commune (spécialité 50 pts, couverture
                simple 20 pts), son stock réel de biens publiés dans cette commune (jusqu’à 25 pts), les
                biens correspondant au budget et au nombre de chambres demandés (jusqu’à 15 pts) et la
                vérification de son numéro WhatsApp (10 pts). Le total est multiplié par la priorité de son
                forfait, puis pondéré par sa réactivité récente et par le nombre de demandes déjà reçues,
                pour que le flux d’une commune ne se concentre pas sur une seule agence.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
