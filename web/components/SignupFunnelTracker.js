'use client';

import { useEffect } from 'react';
import { trackSignupStep } from '@/lib/analyticsClient';

/**
 * Listens to a server-rendered signup form and reports how far the visitor
 * got (lib/analyticsClient.js trackSignupStep): the first time any field takes
 * focus, the submit, a tap on an element marked `data-signup-step` (the
 * WhatsApp route, the referral-code toggle). Each step once per page load.
 *
 * Renders nothing, and the form keeps working without it: it only listens.
 * The form stays a Server Component posting to its Server Action; this is
 * mounted beside it and finds it by id.
 */
export default function SignupFunnelTracker({ formId, form = 'agent', scopeId = null }) {
  useEffect(() => {
    const formEl = document.getElementById(formId);
    const scope = (scopeId && document.getElementById(scopeId)) || formEl?.parentElement || document;
    const sent = new Set();
    const once = (step) => {
      if (sent.has(step)) return;
      sent.add(step);
      trackSignupStep(form, step);
    };

    const onFocus = () => once('form_start');
    const onSubmit = () => once('submit');
    const onClick = (event) => {
      const step = event.target?.closest?.('[data-signup-step]')?.getAttribute('data-signup-step');
      if (step) once(step);
    };

    formEl?.addEventListener('focusin', onFocus);
    formEl?.addEventListener('submit', onSubmit);
    scope.addEventListener('click', onClick);
    return () => {
      formEl?.removeEventListener('focusin', onFocus);
      formEl?.removeEventListener('submit', onSubmit);
      scope.removeEventListener('click', onClick);
    };
  }, [formId, form, scopeId]);

  return null;
}
