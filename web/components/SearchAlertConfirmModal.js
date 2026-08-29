'use client';

import { Bell } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Shown to an already-authenticated visitor before SaveSearchButton.js
 * actually creates the alert — a real review step, not a rubber stamp: the
 * tags are `lib/searchLabel.js`'s `searchCriteriaTags`, the exact same
 * function that renders each saved search's criteria row on
 * /compte/client's Alertes tab (AlertsBoard.js), so what this modal shows is
 * provably what gets saved, not a separately-maintained summary that could
 * drift from it.
 *
 * No notification-frequency toggle (Instant / Daily summary): this app has
 * no notification delivery mechanism at all behind saved searches — the
 * "alert" is a real saved query that /compte/client/alertes re-checks and
 * badges with a new-matches count when the visitor comes back to look, not
 * a push/email/WhatsApp system with a schedule to configure. A frequency
 * control here would set a value nothing ever reads.
 */
export default function SearchAlertConfirmModal({ open, onClose, onConfirm, tags = [] }) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="gap-5 p-6">
        <DialogTitle className="flex items-center gap-2 text-left font-display text-lg font-normal leading-snug tracking-[-0.01em] text-ink">
          <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-blue" />
          Créer une alerte pour cette recherche
        </DialogTitle>

        <div>
          <p className="mb-2.5 text-sm text-ink-45">Vous serez alerté des nouveaux biens correspondant à :</p>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span key={tag} className="u-tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-70">Tous les biens disponibles.</p>
          )}
        </div>

        <button
          type="button"
          onClick={onConfirm}
          className="u-press u-btn-primary mt-1 inline-flex items-center justify-center gap-2 rounded-md bg-blue py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
        >
          <Bell strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          Confirmer l&rsquo;alerte
        </button>
      </DialogContent>
    </Dialog>
  );
}
