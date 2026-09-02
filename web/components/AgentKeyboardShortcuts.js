'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { OPEN_CREATE_LISTING_EVENT, OPEN_CREATE_LISTING_STORAGE_KEY } from '@/lib/agentShortcutEvents';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Two global shortcuts across the whole /compte/agent/** dashboard, mounted
 * once in the layout so they work regardless of which page is open:
 *
 *   "/"  focuses the page's search box (AgentPageHeader's #agent-page-search
 *        input) — a no-op on pages that render none (Paramètres,
 *        Abonnement, the editor), since there's nothing to focus.
 *   "N"  opens the "Ajouter un bien" dialog — see CreateListingDialog.js's
 *        own doc comment for why this opens the existing in-place dialog
 *        rather than navigating to a `/biens/nouveau` page that doesn't
 *        exist; creation on this dashboard has always been a dialog, not a
 *        route.
 *
 * Both are ignored while the browser's real focus is already inside a
 * text-editable element (an input, textarea, select, or a contentEditable
 * node) — otherwise typing a listing description containing the letter "n"
 * or searching for anything containing "/" would keep firing the shortcut
 * mid-keystroke. Also ignored with any modifier held (Cmd/Ctrl/Alt/Meta),
 * so this never fights a real browser or OS shortcut.
 */
export default function AgentKeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;
      const isEditable =
        (target?.tagName && EDITABLE_TAGS.has(target.tagName)) || target?.isContentEditable;
      if (isEditable) return;

      if (event.key === '/') {
        const search = document.getElementById('agent-page-search');
        if (search) {
          event.preventDefault();
          search.focus();
        }
        return;
      }

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        if (pathname === '/compte/agent/biens') {
          window.dispatchEvent(new Event(OPEN_CREATE_LISTING_EVENT));
        } else {
          try {
            window.sessionStorage.setItem(OPEN_CREATE_LISTING_STORAGE_KEY, '1');
          } catch {
            // Private-browsing storage access can throw — the navigation
            // below still happens, the dialog just won't auto-open there.
          }
          router.push('/compte/agent/biens');
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pathname, router]);

  return null;
}
