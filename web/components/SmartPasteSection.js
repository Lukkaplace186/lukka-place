'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { parseListingTextAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * "Auto-Fill from WhatsApp Text" — shared by CreateListingDialog and
 * AgentListingEditor (root CLAUDE.md's Smart Paste section). Owns only the
 * raw-text input and the call to the engine's extractor; mapping the result
 * onto real form fields is the caller's job via `onParsed`, since the two
 * forms have different fields (the create dialog has purpose/category_id,
 * the editor has amenity checkboxes and no property type field at all).
 *
 * @param {Object} props
 * @param {(extracted: Object, rawText: string) => void} props.onParsed
 */
export default function SmartPasteSection({ onParsed }) {
  const t = useT();
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);

  async function handleParse() {
    const trimmed = text.trim();
    if (!trimmed) {
      showToast({ type: 'error', message: t('errors.pasteTextRequired') });
      return;
    }

    setPending(true);
    const result = await parseListingTextAction(trimmed);
    setPending(false);

    if (!result.ok) {
      showToast({ type: 'error', message: result.error });
      return;
    }

    onParsed(result.extracted, trimmed);

    const { confidence } = result.extracted || {};
    const lowConfidence = typeof confidence === 'number' && confidence < LOW_CONFIDENCE_THRESHOLD;
    showToast({
      type: lowConfidence ? 'error' : 'success',
      message: lowConfidence
        ? t('agent.editor.smartPasteLowConfidence')
        : t('agent.editor.smartPasteSuccess'),
    });
  }

  return (
    <div className="u-card flex flex-col gap-3 rounded-card border border-dashed border-line bg-canvas-alt p-6">
      <div>
        <h2 className="flex items-center gap-1.5 text-[1.0625rem] font-bold text-ink">
          <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-blue-deep" aria-hidden="true" />
          {t('agent.editor.smartPasteTitle')}
        </h2>
        <p className="mt-1 text-xs text-ink-45">{t('agent.editor.smartPasteHint')}</p>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={t('agent.editor.smartPastePlaceholder')}
        className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
      />

      <button
        type="button"
        onClick={handleParse}
        disabled={pending}
        className="u-press inline-flex h-10 w-fit items-center gap-1.5 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
      >
        <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-hidden="true" />
        {pending ? t('agent.editor.smartPasteButtonPending') : t('agent.editor.smartPasteButton')}
      </button>
    </div>
  );
}
