'use client';

import { useEffect } from 'react';
import { trackCustomerSignup } from '@/lib/analyticsClient';

/**
 * `form_view` for the customer sign-up funnel (lib/signupFunnelRules.js):
 * once per page load of /compte/inscription, with the entry it came from.
 * Renders nothing; the page works the same without it.
 */
export default function CustomerSignupTracker({ entry }) {
  useEffect(() => {
    trackCustomerSignup('form_view', entry);
  }, [entry]);
  return null;
}
