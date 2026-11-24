'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import LocalSavesFields from './LocalSavesFields';
import { verifySignInCodeAction } from '@/app/(site)/compte/connexion/whatsappActions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The 6-digit code we sent to an existing account's WhatsApp, typed here
 * (2026-11-24). Sends itself once six digits are in (pasted, typed, or offered
 * by the keyboard from the WhatsApp notification: autoComplete one-time-code).
 * Labels come from the page (server-side `t`), so this works whatever subset
 * of `auth` the layout ships to the browser.
 *
 * @param {{next: string, labels: {code: string, signIn: string, errors: Record<string, string>}}} props
 */
export default function SignInCodeForm({ next, labels }) {
  const [state, action, pending] = useActionState(verifySignInCodeAction, null);
  const formRef = useRef(null);
  const error = state?.error ? labels.errors[state.error] || labels.errors.invalid : null;

  return (
    <form ref={formRef} action={action} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <LocalSavesFields />
      <label htmlFor="signin-code" className="u-micro-strong text-ink">{labels.code}</label>
      <input
        key={state?.attempt || 'first'}
        id="signin-code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        autoFocus
        required
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          if (digits.length === 6 && !pending) formRef.current?.requestSubmit();
        }}
        className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-3 text-center text-xl tracking-[0.4em] text-ink"
      />
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="u-press u-btn-primary flex min-h-12 items-center justify-center gap-2 rounded-full bg-blue-deep px-4 text-[0.9375rem] font-semibold text-white disabled:opacity-60"
      >
        {pending ? <Loader2 strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
        {labels.signIn}
      </button>
    </form>
  );
}

const COOLDOWN_SECONDS = 45;

/**
 * "Renvoyer le code" with a cooldown: each send is a paid template and a
 * message on their phone (the server also caps it, lib/signInCodeLimits.js).
 * The page keys it on the `sent` marker, so a finished resend starts a new timer.
 *
 * @param {{labels: {now: string, sending: string, retryIn: string}, startCooling?: boolean}} props
 *   `retryIn` carries `{seconds}`.
 */
export function ResendCodeButton({ labels, startCooling = true }) {
  const [seconds, setSeconds] = useState(startCooling ? COOLDOWN_SECONDS : 0);
  const { pending } = useFormStatus();

  useEffect(() => {
    if (seconds <= 0) return undefined;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const blocked = pending || seconds > 0;
  let label = labels.now;
  if (pending) label = labels.sending;
  else if (seconds > 0) label = labels.retryIn.replace('{seconds}', String(seconds));
  return (
    <button
      type="submit"
      disabled={blocked}
      className="text-sm font-semibold text-blue-deep underline underline-offset-2 hover:text-blue disabled:cursor-not-allowed disabled:text-ink-35 disabled:no-underline"
    >
      {label}
    </button>
  );
}

const LATE_CODE_MS = 30 * 1000;

/**
 * The older way, kept for a code that does not arrive (Chakra confirms no
 * delivery): mounted only when asked for, so its 3-second polling does not
 * run for everyone who types the code. Open from the start when the code
 * could not be sent (`defaultOpen`); after 30 s without a sign-in the link
 * becomes a visible box with `lateLabel` ("Toujours pas de code ?"), since a
 * code that is coming has usually come by then.
 *
 * @param {{label: string, lateLabel?: string, defaultOpen?: boolean, children: React.ReactNode}} props
 */
export function CodeFallback({ label, lateLabel = null, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (open || !lateLabel) return undefined;
    const timer = setTimeout(() => setLate(true), LATE_CODE_MS);
    return () => clearTimeout(timer);
  }, [open, lateLabel]);

  if (open) return children;
  if (late) {
    return (
      <div className="mt-5 rounded-md bg-blue-tint px-3 py-3 text-center">
        <p className="text-sm text-ink">{lateLabel}</p>
        <button type="button" onClick={() => setOpen(true)} className="mt-1 text-sm font-semibold text-blue-deep underline underline-offset-2">
          {label}
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => setOpen(true)} className="mt-5 w-full text-center text-sm font-semibold text-ink-70 underline underline-offset-2 hover:text-ink">
      {label}
    </button>
  );
}
