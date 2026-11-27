'use client';

import { useEffect } from 'react';
import { trackCustomerSignup } from '@/lib/analyticsClient';

/**
 * Reports a sign-up prompt as shown once, from a server-rendered page whose
 * whole point is the prompt (/alertes-whatsapp, 2026-11-24). Renders nothing.
 * Signed-in visitors are counted too; the funnel counts people, and the
 * account step itself says who signed up.
 */
export default function SignupPromptBeacon({ entry }) {
  useEffect(() => {
    trackCustomerSignup('prompt_shown', entry);
  }, [entry]);
  return null;
}
