'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import {
  QUICK_REPLY_BODY_MAX,
  QUICK_REPLY_MAX_PER_AGENT,
  QUICK_REPLY_PLACEHOLDERS,
  QUICK_REPLY_TITLE_MAX,
} from '@/lib/quickReplyRules';
import { saveQuickReplyAction, deleteQuickReplyAction } from '@/app/compte/agent/quickReplyActions';
import { useToast } from './Toast';
import { useT } from '@/lib/i18n/client';

/**
 * The "Réponses rapides" card on /compte/agent/parametres: list, edit, add,
 * delete. Placeholders are inserted at the cursor as `{name}` so the agent
 * never has to remember the spelling; the server refuses an unknown one
 * (lib/quickReplyRules.js's validateQuickReply).
 *
 * `editable` is false before the migration runs — the defaults still show,
 * and the sheet on lead cards still works from them, but nothing can be saved.
 */
export default function AgentQuickRepliesManager({ templates, customised, editable }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [editingId, setEditingId] = useState(null); // template id, 'new', or null
  const [pending, startTransition] = useTransition();

  function run(work, successKey) {
    startTransition(async () => {
      let result;
      try {
        result = await work();
      } catch (err) {
        console.error('[AgentQuickRepliesManager] action failed', err);
        showToast({ type: 'error', message: t('errors.submissionFailed') });
        return;
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('errors.submissionFailed') });
        return;
      }
      showToast({ type: 'success', message: t(successKey) });
      setEditingId(null);
      router.refresh();
    });
  }

  function handleSave(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(() => saveQuickReplyAction(formData), 'agent.quickReplies.saved');
  }

  function handleDelete(template) {
    if (!window.confirm(t('agent.quickReplies.confirmDelete', { title: template.title }))) return;
    run(() => deleteQuickReplyAction(template.id), 'agent.quickReplies.deleted');
  }

  const atLimit = templates.length >= QUICK_REPLY_MAX_PER_AGENT;

  return (
    <div className="flex flex-col gap-3">
      {!customised && <p className="u-micro text-ink-45">{t('agent.quickReplies.defaultsNote')}</p>}
      {!editable && (
        <p className="u-micro rounded-lg bg-warning-tint px-3 py-2 text-warning" role="status">
          {t('agent.quickReplies.notEditableYet')}
        </p>
      )}

      {templates.length === 0 && editingId !== 'new' && (
        <p className="u-micro rounded-lg bg-canvas-alt px-3 py-2 text-ink-70">{t('agent.quickReplies.emptyList')}</p>
      )}

      <ul className="flex flex-col gap-2.5">
        {templates.map((template) =>
          editingId === template.id ? (
            <li key={template.id}>
              <TemplateForm template={template} pending={pending} onSubmit={handleSave} onCancel={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={template.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="u-micro-strong text-ink">{template.title}</div>
              <p className="u-micro line-clamp-3 whitespace-pre-line text-ink-45">{template.body}</p>
              {editable && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setEditingId(template.id)}
                    className="u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-semibold text-ink-70 hover:bg-canvas-alt hover:text-ink disabled:opacity-60"
                  >
                    <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('agent.quickReplies.edit')}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleDelete(template)}
                    className="u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-semibold text-danger hover:bg-danger-tint disabled:opacity-60"
                  >
                    <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('agent.quickReplies.delete')}
                  </button>
                </div>
              )}
            </li>
          ),
        )}
      </ul>

      {editingId === 'new' && (
        <TemplateForm template={null} pending={pending} onSubmit={handleSave} onCancel={() => setEditingId(null)} />
      )}

      {editable && editingId !== 'new' && (
        atLimit ? (
          <p className="u-micro text-ink-45">{t('agent.quickReplies.limitReached', { max: QUICK_REPLY_MAX_PER_AGENT })}</p>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditingId('new')}
            className="u-btn-secondary u-press inline-flex h-10 items-center justify-center gap-1.5 self-start rounded-lg px-4 text-[0.8125rem] font-bold text-ink disabled:opacity-60"
          >
            <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('agent.quickReplies.add')}
          </button>
        )
      )}
    </div>
  );
}

function TemplateForm({ template, pending, onSubmit, onCancel }) {
  const t = useT();
  const bodyRef = useRef(null);
  const formId = template ? `qr-${template.id}` : 'qr-new';

  function insertPlaceholder(name) {
    const el = bodyRef.current;
    if (!el) return;
    const token = `{${name}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = `${el.value.slice(0, start)}${token}${el.value.slice(end)}`;
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-blue/40 bg-canvas-alt p-3">
      <input type="hidden" name="id" value={template?.id || ''} />
      <div>
        <label htmlFor={`${formId}-title`} className="u-micro-strong mb-1.5 block text-ink-70">
          {t('agent.quickReplies.titleLabel')}
        </label>
        <input
          id={`${formId}-title`}
          name="title"
          required
          maxLength={QUICK_REPLY_TITLE_MAX}
          defaultValue={template?.title || ''}
          className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
        />
      </div>
      <div>
        <label htmlFor={`${formId}-body`} className="u-micro-strong mb-1.5 block text-ink-70">
          {t('agent.quickReplies.bodyLabel')}
        </label>
        <textarea
          id={`${formId}-body`}
          ref={bodyRef}
          name="body"
          required
          rows={5}
          maxLength={QUICK_REPLY_BODY_MAX}
          defaultValue={template?.body || ''}
          className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink"
        />
        <p className="mt-1 text-xs text-ink-45">{t('agent.quickReplies.placeholdersHint')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_REPLY_PLACEHOLDERS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => insertPlaceholder(name)}
              className="u-press inline-flex min-h-10 items-center rounded-full bg-surface px-3 text-xs font-semibold text-ink-70 ring-1 ring-line hover:text-ink"
            >
              {t(`agent.quickReplies.placeholders.${name}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="u-btn-primary u-press h-10 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
        >
          {t('common.actions.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="u-press h-10 rounded-lg px-3 text-[0.8125rem] font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
        >
          {t('common.actions.cancel')}
        </button>
      </div>
    </form>
  );
}
