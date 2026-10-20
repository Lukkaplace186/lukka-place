'use client';

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { useBulkDelete } from '../BulkDelete';

/**
 * "Supprimer l'annonce" on the listing's own page: the same soft delete as the
 * table's bulk bar (deleted_at + status 0, lib/adminSoftDelete.js), with its
 * confirmation and 10-second undo. Photos stay in storage, so the undo can
 * bring the listing back whole. Back to the list afterwards.
 */
export default function DeleteListingButton({ id }) {
  const t = useT();
  const router = useRouter();
  const del = useBulkDelete('listing', { onDeleted: () => router.push('/admin/listings') });
  return (
    <>
      <button
        type="button"
        disabled={del.pending}
        onClick={() => del.request([id])}
        className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-surface px-3 text-danger hover:bg-danger/5 disabled:opacity-50"
      >
        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        {t('admin.listings.deleteOne')}
      </button>
      {del.dialog}
    </>
  );
}
