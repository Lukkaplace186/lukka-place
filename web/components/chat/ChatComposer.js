'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';
import { CHAT_MESSAGE_MAX } from '@/lib/chatRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';

const MAX_HEIGHT_PX = 160;
const COUNTER_FROM = CHAT_MESSAGE_MAX - 200;

/**
 * The message field and send button. Grows with its text up to ~6 lines.
 * Enter sends on a computer (Shift+Enter for a new line); on a phone Enter is
 * a new line and the button sends, which is what phone keyboards expect.
 *
 * `suggestions` are one-tap messages shown above the field (the first message
 * screen, the agent's quick replies): a string, or `{label, text}`. Tapping
 * one fills the field rather than sending it, so a line can still be added.
 * `leading` is a control drawn left of the field (the agent's "Partager un
 * bien").
 */
export default function ChatComposer({ onSend, disabled = false, t, suggestions = [], autoFocus = false, initialValue = '', leading = null }) {
  const [value, setValue] = useState(initialValue);
  const fieldRef = useRef(null);
  const trimmed = value.trim();
  const tooLong = value.length > CHAT_MESSAGE_MAX;
  const canSend = !disabled && trimmed.length > 0 && !tooLong;

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
    // A scrollbar only once the text is taller than the field may grow.
    field.style.overflowY = field.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) fieldRef.current?.focus();
  }, [autoFocus]);

  function submit() {
    if (!canSend) return;
    const sent = onSend(trimmed);
    if (sent !== false) setValue('');
    fieldRef.current?.focus();
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    event.preventDefault();
    submit();
  }

  return (
    <div className="flex flex-col gap-2.5">
      {suggestions.length > 0 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label={t('chat.start.suggestionsLabel')}>
          {suggestions.map((item) => {
            // A plain string is both label and text; a quick reply carries a
            // short title and inserts its (longer) rendered body.
            const label = typeof item === 'string' ? item : item.label;
            const text = typeof item === 'string' ? item : item.text;
            return (
            <button
              key={label}
              type="button"
              title={text !== label ? text : undefined}
              onClick={() => {
                setValue(text);
                fieldRef.current?.focus();
              }}
              className="u-press u-focus-ring inline-flex h-10 flex-none items-center rounded-full border border-blue/30 bg-surface px-3.5 text-[0.8125rem] font-semibold whitespace-nowrap text-blue-deep transition-colors hover:bg-blue-tint"
            >
              {label}
            </button>
            );
          })}
        </div>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {leading}
        <label htmlFor="chat-composer" className="sr-only">
          {t('chat.composer.label')}
        </label>
        <textarea
          id="chat-composer"
          ref={fieldRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.composer.placeholder')}
          enterKeyHint="send"
          className="min-h-11 flex-1 resize-none rounded-[1.375rem] border border-line bg-canvas-alt px-4 py-[0.6875rem] text-[0.9375rem] leading-snug text-ink outline-none transition-colors placeholder:text-ink-45 focus:border-blue focus:bg-surface disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t('chat.composer.send')}
          className={cn(
            'u-press u-focus-ring grid h-11 w-11 flex-none place-items-center rounded-full transition-colors',
            canSend ? 'bg-blue text-white hover:bg-blue-deep' : 'bg-line text-ink-35',
          )}
        >
          <SendHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </button>
      </form>
      {value.length > COUNTER_FROM ? (
        <p className={cn('u-tabular text-right text-[0.75rem]', tooLong ? 'font-semibold text-danger' : 'text-ink-45')} aria-live="polite">
          {t('chat.composer.counter', { count: value.length.toLocaleString('fr-FR'), max: CHAT_MESSAGE_MAX.toLocaleString('fr-FR') })}
        </p>
      ) : null}
    </div>
  );
}
