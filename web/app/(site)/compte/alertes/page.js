import { redirect } from 'next/navigation';

/**
 * The old standalone Alertes page. It was a second, drifting copy of the
 * Espace Client's Alertes sub-tab — re-running every saved search on its own,
 * stamping them viewed on its own, and still telling visitors alerts were
 * pull-only long after the WhatsApp sweep existed. The portal tab has the
 * alert frequency, rename, delete-with-undo and WhatsApp settings; this has
 * none of them. Kept only so existing links (Header, bookmarks) still land.
 */
export default function AlertesPage() {
  redirect('/compte/client?tab=alertes');
}
