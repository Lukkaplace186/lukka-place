'use client';

import { createContext, useContext, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { MAX_SAVED_SEARCHES } from '@/lib/accountLimits';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { removeSavedSearchAction, restoreSavedSearchAction } from '../actions';

const RemoveContext = createContext(null);

/**
 * Instant delete for one alert card on the (server-rendered) AlertsBoard.
 *
 * The card's content stays a Server Component — it carries PropertyCards and
 * the search's criteria tags — and is passed in as `children`; only the
 * hide/undo state lives here. The delete button sits deep inside that
 * content, so it reaches this wrapper through context (RemoveAlertButton).
 *
 * Undo works after the server refresh has already dropped this card:
 * restoreSavedSearchAction re-creates the search, and the next refresh
 * renders it again as a fresh card.
 */
export function RemovableAlert({ query, label, children }) {
  const t = useT();
  const { showToast } = useToast();
  const [removed, setRemoved] = useState(false);

  function restore() {
    setRemoved(false);
    restoreSavedSearchAction({ query, label })
      .catch(() => ({ ok: false }))
      .then((result) => {
        if (result?.ok) return;
        setRemoved(true);
        showToast({
          type: 'error',
          message: result?.reason === 'limit'
            ? t('account.limits.savedSearches', { max: MAX_SAVED_SEARCHES })
            : t('account.alerts.restoreFailed'),
        });
      });
  }

  function remove() {
    setRemoved(true);
    removeSavedSearchAction(query)
      .catch(() => ({ ok: false }))
      .then((result) => {
        if (!result?.ok) {
          setRemoved(false);
          showToast({ type: 'error', message: t('account.alerts.removeFailed') });
          return;
        }
        showToast({
          message: t('account.alerts.removed'),
          action: { label: t('account.portal.undo'), onClick: restore },
        });
      });
  }

  if (removed) return null;
  return <RemoveContext.Provider value={remove}>{children}</RemoveContext.Provider>;
}

export function RemoveAlertButton({ label }) {
  const t = useT();
  const remove = useContext(RemoveContext);
  return (
    <button
      type="button"
      onClick={remove || undefined}
      disabled={!remove}
      aria-label={t('account.alerts.deleteSearch', { label })}
      title={t('account.alerts.deleteAlert')}
      className="u-press inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-45 transition-colors hover:bg-danger-tint hover:text-danger"
    >
      <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
