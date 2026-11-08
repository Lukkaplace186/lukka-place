'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

/**
 * A password field with a show/hide eye (2026-11-08, owner request: a
 * password typed blind on a phone, with no confirmation field, was a typo
 * away from a WhatsApp reset). Hidden by default; the eye flips it for as
 * long as the customer wants. Controlled when `value`/`onChange` are given,
 * so a refused form can keep what was typed.
 */
export default function PasswordInput({ id, name = 'password', autoComplete, className, inputClassName, value, onChange, ...rest }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const Icon = shown ? EyeOff : Eye;
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        name={name}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...(onChange ? { value, onChange } : {})}
        {...rest}
        className={cn('u-focus-ring w-full rounded-md border border-line bg-white py-2 pl-3 pr-11 text-sm text-ink', inputClassName)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={shown}
        aria-controls={id}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-45 hover:text-ink"
      >
        <Icon strokeWidth={2} className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
      </button>
    </div>
  );
}
