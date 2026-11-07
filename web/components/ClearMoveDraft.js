'use client';

import { useEffect } from 'react';
import { clearMoveDraft } from '@/lib/moveDraft';

/**
 * Rendered inside the signed-in Espace Client: being here means the account
 * exists, so the signup cards' draft has done its job (lib/moveDraft.js).
 */
export default function ClearMoveDraft() {
  useEffect(() => {
    clearMoveDraft();
  }, []);
  return null;
}
