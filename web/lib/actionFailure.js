import { isNetworkError } from './networkError';

/**
 * The toast for a Server Action that REJECTED (as opposed to one that answered
 * `{ ok: false, error }`, which carries its own message).
 *
 * A rejection is what an agent gets when the connection drops mid-tap, when
 * their session expired (the action throws "Not authenticated"), or when a
 * request is refused before the action runs. Before this helper, six
 * dashboard buttons had no catch at all — the transition threw, and the agent
 * saw a button that did nothing — and the ones that did catch printed
 * `err.message`, which production replaces with React's generic English
 * "An error occurred in the Server Components render…".
 *
 * Two messages, because they need different responses: a dropped connection
 * gets "Réessayer" (safe: every action behind these buttons is idempotent or
 * guarded server-side), anything else says what most likely happened — the
 * session — and what to do about it.
 *
 * @param {Function} t        the client translator (useT)
 * @param {unknown} err       what the action rejected with
 * @param {Function} [retry]  re-runs the same action; offered on a network drop only
 * @returns {{type: 'error', message: string, action: {label: string, onClick: Function}|null}}
 */
export function actionFailureToast(t, err, retry) {
  const offline = isNetworkError(err);
  if (!offline) console.error('[agent action]', err);
  return {
    type: 'error',
    message: offline ? t('agent.actionError.offline') : t('agent.actionError.failed'),
    action: offline && typeof retry === 'function' ? { label: t('agent.actionError.retry'), onClick: retry } : null,
  };
}
