'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Shuffle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

/**
 * The admin's "set this account's password" form, shared by
 * /admin/agents/[id] and /admin/customers so both roles behave identically
 * (lib/adminPasswordReset.js makes the same promise on the server side).
 *
 * `action` is a Server Action already bound to the account id by the page
 * that renders it — the id never travels through the form, so it cannot be
 * swapped in the browser.
 *
 * **The typed password is shown in clear.** That is deliberate, not an
 * oversight: an admin using this is about to read the password out over the
 * phone or WhatsApp, and a masked field they cannot check is how an account
 * ends up locked harder than it started. The confirm field is checked on the
 * server too — see adminSetAccountPassword.
 */
export default function PasswordResetForm({ action, accountLabel, compact = false }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const formRef = useRef(null);

  // Generated in the browser with the platform CSPRNG. It only has to be
  // unguessable and easy to read aloud once; the account holder is expected
  // to change it, and every session dies the moment it is set anyway.
  function suggest() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    const generated = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
    setValue(generated);
    setConfirm(generated);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await action(formData);
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('admin.password.failed') });
        return;
      }
      showToast({ type: 'success', message: t('admin.password.done') });
      setValue('');
      setConfirm('');
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className={compact ? 'flex flex-col gap-3' : 'flex flex-col gap-4'}>
      {!compact && <h2 className="u-title-card text-ink">{t('admin.password.title')}</h2>}
      <p className="u-micro text-ink-45">
        {t('admin.password.hint')}
        {accountLabel ? ` (${accountLabel})` : ''}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={LABEL}>{t('admin.password.newPassword')}</span>
          <input
            name="password"
            type="text"
            autoComplete="off"
            spellCheck={false}
            minLength={8}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <span className={LABEL}>{t('admin.password.confirmPassword')}</span>
          <input
            name="password_confirm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            minLength={8}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="u-btn-primary u-press inline-flex h-10 items-center gap-2 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
        >
          <KeyRound strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? t('admin.password.saving') : t('admin.password.submit')}
        </button>
        <button
          type="button"
          onClick={suggest}
          disabled={pending}
          className="u-btn-secondary u-press inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[0.8125rem] font-bold text-ink disabled:opacity-60"
        >
          <Shuffle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.password.generate')}
        </button>
      </div>

      <p className="u-micro text-ink-35">{t('admin.password.sessionsNote')}</p>
    </form>
  );
}
