'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import SignupForm from '@/app/(site)/compte/inscription/SignupForm';
import { checkSignupPhoneAction, signInWithNumberAction, signupAction } from '@/app/(site)/compte/inscription/actions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { trackCustomerSignup } from '@/lib/analyticsClient';
import { useT } from '@/lib/i18n/client';

/**
 * The account form inside a sheet or a dialog, without leaving the page
 * (2026-11-18). The same form and the same signupAction as /compte/inscription
 * — name, number, password (the name stays required: agents call the
 * customer back by it) — in its compact form. Success redirects to `next`,
 * which is the page the visitor is on (with the save/alert resume marker
 * when a ♥ or an alert asked), so they carry on where they were, signed in.
 *
 * `perkKeys` are the reasons, in the visitor's terms, shown above the form.
 *
 * Funnel: the prompt that opened this reports `prompt_shown`; the first
 * character typed here is its `prompt_open` (there is no button towards a
 * sign-up page any more), then SignupForm's own form_start / submit follow.
 */
export default function QuickSignup({
  next,
  entry,
  perkKeys = [],
  alsoSaveIds = [],
  autoFocusName = false,
  idPrefix = 'quick-',
}) {
  const t = useT();
  const engaged = useRef(false);
  function onFirstInput() {
    if (engaged.current) return;
    engaged.current = true;
    trackCustomerSignup('prompt_open', entry);
  }
  return (
    <div className="flex flex-col gap-4" onInput={onFirstInput}>
      {perkKeys.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {perkKeys.map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm text-ink-70">
              <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-green-deep" aria-hidden="true" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <SignupForm
        action={signupAction}
        next={next}
        entry={entry}
        checkPhoneAction={checkSignupPhoneAction}
        signInAction={signInWithNumberAction}
        compact
        idPrefix={idPrefix}
        autoFocusName={autoFocusName}
        submitLabelKey="listings.quickSignup.submit"
        alsoSaveIds={alsoSaveIds}
      />
      <p className="text-center text-sm text-ink-45">
        {t('listings.authPrompt.alreadyHaveAccount')}{' '}
        <Link href={`/compte/connexion?next=${encodeURIComponent(next)}`} className="font-semibold text-blue-deep hover:underline">
          {t('common.shared.signIn')}
        </Link>
      </p>
    </div>
  );
}
