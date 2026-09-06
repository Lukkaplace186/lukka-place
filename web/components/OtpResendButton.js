'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useT } from '@/lib/i18n/client';

/**
 * Resend control with a real cooldown.
 *
 * Two reasons this isn't just a plain submit button: a WhatsApp template
 * send costs money per message and Meta rate-limits repeated sends to the
 * same recipient, so an impatient tap-tap-tap is worth preventing at the
 * UI; and a code that has genuinely not arrived yet is the exact moment
 * someone taps repeatedly, which is when the cooldown matters most.
 *
 * The countdown restarts by REMOUNTING: the page gives this component a
 * `key` derived from the `?sent=1` marker, so a completed resend round-trip
 * gets a fresh `useState` rather than a reset written from inside an effect.
 * Resetting state in an effect is the cascading-render pattern React's own
 * lint rule rejects, and `key` is the supported way to say "this is
 * conceptually a new timer".
 *
 * Its three labels were hardcoded French until this component moved out of
 * the agent signup folder and started serving the customer flow too, where
 * an English page rendered one French button.
 */
const COOLDOWN_SECONDS = 45;

function Inner({ seconds }) {
  const t = useT();
  const { pending } = useFormStatus();
  const blocked = pending || seconds > 0;

  return (
    <button
      type="submit"
      disabled={blocked}
      className="text-sm font-semibold text-blue-deep underline underline-offset-2 transition-colors hover:text-blue disabled:cursor-not-allowed disabled:text-ink-35 disabled:no-underline"
    >
      {pending ? t('auth.resend.sending') : seconds > 0 ? t('auth.resend.retryIn', { seconds }) : t('auth.resend.now')}
    </button>
  );
}

export default function ResendButton() {
  const [seconds, setSeconds] = useState(COOLDOWN_SECONDS);

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  return <Inner seconds={seconds} />;
}
