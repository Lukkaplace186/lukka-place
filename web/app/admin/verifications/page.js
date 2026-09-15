import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { getAgentVerification, listVerificationDocuments } from '@/lib/agentVerification';
import { getAgentNamesByIds } from '@/lib/agents';
import {
  DOC_STATUS_LABEL_KEYS,
  DOC_TYPE_LABEL_KEYS,
  LEVEL_LABEL_KEYS,
  VERIFICATION_DOC_STATUSES,
  VERIFICATION_LEVELS,
} from '@/lib/verificationLevels';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import { reviewVerificationDocumentAction, setAgentVerificationLevelAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Vérifications — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const PATH = '/admin/verifications';

const STATUS_TONE = { pending: 'warning', approved: 'success', rejected: 'danger' };

const TAB_KEYS = {
  pending: 'admin.verifications.tabPending',
  approved: 'admin.verifications.tabApproved',
  rejected: 'admin.verifications.tabRejected',
};

const FLASH = {
  reviewed: { tone: 'success', key: 'admin.verifications.documentReviewed' },
  note_required: { tone: 'danger', key: 'admin.verifications.noteRequired' },
  invalid: { tone: 'danger', key: 'admin.verifications.invalid' },
};

const LEVEL_ERROR_KEYS = {
  identity_required: 'admin.verifications.missing.identity_required',
  rccm_required: 'admin.verifications.missing.rccm_required',
  unknown_level: 'admin.verifications.missing.unknown_level',
  not_found: 'admin.verifications.missing.not_found',
};

const FIELD = 'u-focus-ring h-8 rounded-md border border-line bg-surface px-2 text-[0.8125rem] text-ink';
const BUTTON = 'u-press inline-flex h-8 items-center rounded-md px-3 text-[0.8125rem] font-bold';

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
}

function Banner({ tone, children }) {
  const cls = tone === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger';
  return (
    <p className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${cls}`} role={tone === 'success' ? 'status' : 'alert'}>
      {children}
    </p>
  );
}

/**
 * The review queue for agent identity documents and RCCMs.
 *
 * One server page at a time, like every other console list (web/CLAUDE.md,
 * "Built for 30k agents"): the queue can reach thousands of documents at
 * launch, and nothing here loads more than a page. Pending is worked
 * oldest-first.
 *
 * `?agent=<id>` narrows to one agent and opens the level panel, because a
 * level is decided on the evidence as a whole, not one document at a time.
 *
 * Reading the queue is agents.view (section permission); every action and the
 * document route itself require agents.manage — the files are ID cards.
 */
export default async function AdminVerificationsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const statusParam = firstParam(raw.status);
  const status = VERIFICATION_DOC_STATUSES.includes(statusParam) ? statusParam : 'pending';
  const agentParam = Number.parseInt(firstParam(raw.agent), 10);
  const agentId = Number.isInteger(agentParam) && agentParam > 0 ? agentParam : null;
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = {
    status: status === 'pending' ? undefined : status,
    agent: agentId ? String(agentId) : undefined,
    page: page > 1 ? String(page) : undefined,
    size: pageSize === 25 ? undefined : String(pageSize),
  };
  const returnTo = buildHref(PATH, params);

  const session = await getAdminSession();
  const canReview = can(session?.role, 'agents.manage');

  let result = null;
  let loadError = null;
  try {
    result = await listVerificationDocuments({ status, agentId, limit, offset });
  } catch (err) {
    loadError = err.message;
  }
  const rows = result?.rows || [];

  const [names, agentVerification] = await Promise.all([
    getAgentNamesByIds([...rows.map((row) => row.agent_id), agentId].filter(Boolean)).catch(() => new Map()),
    agentId ? getAgentVerification(agentId).catch(() => null) : Promise.resolve(null),
  ]);
  const agentName = (id) => names.get(Number(id))?.name || `Agent #${id}`;

  const flash = FLASH[firstParam(raw.flash)];
  const loweredTo = VERIFICATION_LEVELS.includes(firstParam(raw.lowered)) ? firstParam(raw.lowered) : null;
  const levelErrorKey = LEVEL_ERROR_KEYS[firstParam(raw.level_error)];
  const levelSaved = firstParam(raw.level_saved) === '1';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.verifications.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.verifications.subtitle')}</p>
      </div>

      {result ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('admin.verifications.statPending')} value={result.pending.toLocaleString('fr-FR')} />
        </div>
      ) : null}

      {flash ? <Banner tone={flash.tone}>{t(flash.key)}</Banner> : null}
      {loweredTo ? <Banner tone="danger">{t('admin.verifications.levelLowered', { level: t(LEVEL_LABEL_KEYS[loweredTo]) })}</Banner> : null}
      {levelSaved ? <Banner tone="success">{t('admin.verifications.levelSaved')}</Banner> : null}
      {levelErrorKey ? <Banner tone="danger">{t(levelErrorKey)}</Banner> : null}
      {!canReview ? <p className="u-micro text-ink-45">{t('admin.verifications.reviewNotAllowed')}</p> : null}

      {agentId && agentVerification ? (
        <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="u-title-card text-ink">{t('admin.verifications.agentPanelTitle')}</h2>
            <Link href={buildHref(PATH, params, { agent: '', page: '' })} className="u-micro-strong text-blue-deep hover:underline">
              {t('admin.verifications.showAllAgents')}
            </Link>
          </div>
          <p className="u-micro text-ink-70">
            <Link href={`/admin/agents/${agentId}`} className="font-semibold text-blue-deep hover:underline">
              {t('admin.verifications.agentFilter', { name: agentName(agentId) })}
            </Link>
            {' · '}
            {t('admin.verifications.currentLevel', { level: t(LEVEL_LABEL_KEYS[agentVerification.level] || LEVEL_LABEL_KEYS.standard) })}
          </p>
          {canReview ? (
            <form action={setAgentVerificationLevelAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="agent_id" value={agentId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <select name="level" defaultValue={agentVerification.level} className={FIELD}>
                {VERIFICATION_LEVELS.map((level) => (
                  <option key={level} value={level}>{t(LEVEL_LABEL_KEYS[level])}</option>
                ))}
              </select>
              <button type="submit" className={`${BUTTON} bg-blue text-white`}>{t('admin.verifications.setLevel')}</button>
            </form>
          ) : null}
          <p className="u-micro text-ink-45">{t('admin.verifications.levelHint')}</p>
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-2" aria-label={t('admin.verifications.title')}>
        {VERIFICATION_DOC_STATUSES.map((value) => {
          const active = value === status;
          return (
            <Link
              key={value}
              href={buildHref(PATH, params, { status: value === 'pending' ? '' : value, page: '' })}
              aria-current={active ? 'page' : undefined}
              className={`u-micro-strong rounded-full border px-3.5 py-1.5 ${active ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:bg-canvas-alt'}`}
            >
              {t(TAB_KEYS[value])}
            </Link>
          );
        })}
      </nav>

      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      {result ? (
        <TableFrame
          minWidth="60rem"
          footer={<Pagination pathname={PATH} params={params} total={result.total} page={page} pageSize={pageSize} />}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.verifications.colAgent')}</th>
              <th className={TH_STICKY}>{t('admin.verifications.colDocument')}</th>
              <th className={TH_STICKY}>{t('admin.verifications.colSubmitted')}</th>
              <th className={TH_STICKY}>{t('admin.verifications.colStatus')}</th>
              <th className={TH_STICKY}>{t('admin.verifications.colReview')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5}>{t('admin.verifications.empty')}</EmptyRow>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    <Link href={buildHref(PATH, params, { agent: String(row.agent_id), page: '' })} className="font-semibold text-blue-deep hover:underline">
                      {agentName(row.agent_id)}
                    </Link>
                    <div className="mt-0.5 text-ink-45">{t(LEVEL_LABEL_KEYS[row.verification_level] || LEVEL_LABEL_KEYS.standard)}</div>
                  </td>
                  <td className={TD_DENSE}>
                    <div className="font-semibold text-ink">{t(DOC_TYPE_LABEL_KEYS[row.doc_type] || DOC_TYPE_LABEL_KEYS.other)}</div>
                    <div className="max-w-[16rem] truncate text-ink-45">
                      {[row.original_name, formatSize(row.size_bytes)].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className={`${TD_DENSE} u-tabular whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD_DENSE}>
                    <Chip tone={STATUS_TONE[row.status]}>{t(DOC_STATUS_LABEL_KEYS[row.status])}</Chip>
                    {row.reviewed_at ? (
                      <div className="mt-1 text-ink-45">{t('admin.verifications.reviewedOn', { date: formatKinshasa(row.reviewed_at) })}</div>
                    ) : null}
                    {row.status === 'rejected' && row.review_note ? (
                      <div className="mt-1 max-w-[16rem] text-ink-45">{row.review_note}</div>
                    ) : null}
                  </td>
                  <td className={TD_DENSE}>
                    {canReview ? (
                      <div className="flex flex-col items-start gap-2">
                        <a
                          href={`${PATH}/documents/${row.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="u-micro-strong text-blue-deep hover:underline"
                        >
                          {t('admin.verifications.open')}
                        </a>
                        {row.status !== 'approved' ? (
                          <form action={reviewVerificationDocumentAction}>
                            <input type="hidden" name="document_id" value={row.id} />
                            <input type="hidden" name="status" value="approved" />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <button type="submit" className={`${BUTTON} bg-success text-white`}>{t('admin.verifications.approve')}</button>
                          </form>
                        ) : null}
                        {row.status !== 'rejected' ? (
                          <form action={reviewVerificationDocumentAction} className="flex flex-wrap items-center gap-1.5">
                            <input type="hidden" name="document_id" value={row.id} />
                            <input type="hidden" name="status" value="rejected" />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <input
                              name="note"
                              required
                              maxLength={500}
                              placeholder={t('admin.verifications.rejectNotePlaceholder')}
                              aria-label={t('admin.verifications.rejectNotePlaceholder')}
                              className={`${FIELD} w-56`}
                            />
                            <button type="submit" className={`${BUTTON} border border-line text-danger`}>{t('admin.verifications.reject')}</button>
                          </form>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-ink-35">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </TableFrame>
      ) : null}
    </div>
  );
}
