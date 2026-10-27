'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardPaste } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import { POST_TEXT_MAX, extractCongoPhones } from '@/lib/facebookLeadParser';
import { pasteFacebookPostAction } from './actions';

const FIELD = 'u-focus-ring h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink';
const LABEL = 'u-eyebrow mb-1.5 block text-ink-45';

const SKIP_KEYS = {
  ours: 'admin.facebookProspects.skip.ours',
  agent: 'admin.facebookProspects.skip.agent',
  already_prospect: 'admin.facebookProspects.skip.already_prospect',
};

/**
 * The paste form. The numbers under the text box are a preview from the same
 * parser; pasteFacebookPostAction re-reads the text and decides. After a save
 * the group stays filled in — one usually pastes several posts from a group.
 */
export default function PastePostForm() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState('');
  const [groupName, setGroupName] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const detected = useMemo(() => extractCongoPhones(text), [text]);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setResult(null);
    startTransition(async () => {
      let response;
      try {
        response = await pasteFacebookPostAction(formData);
      } catch (err) {
        response = { ok: false, error: err.message };
      }
      if (!response?.ok) {
        setError(response?.error || t('errors.actionFailed'));
        return;
      }
      setResult(response);
      if (response.found) {
        setText('');
        setAuthorName('');
        setPostUrl('');
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="u-card flex flex-col gap-5 rounded-card bg-surface p-6">
      <label>
        <span className={LABEL}>{t('admin.facebookProspects.postText')}</span>
        <textarea
          name="post_text"
          required
          rows={8}
          maxLength={POST_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('admin.facebookProspects.postTextPlaceholder')}
          className="u-focus-ring w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink"
        />
      </label>

      <div aria-live="polite" className="u-micro text-ink-70">
        {text.trim() ? (
          detected.length ? (
            <>
              <span className="font-semibold">{t('admin.facebookProspects.detected', { count: detected.length })}</span>{' '}
              <span className="u-tabular text-ink-45">{detected.join(' · ')}</span>
            </>
          ) : (
            t('admin.facebookProspects.noneDetected')
          )
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          <span className={LABEL}>{t('admin.facebookProspects.groupName')}</span>
          <input name="group_name" maxLength={300} value={groupName} onChange={(e) => setGroupName(e.target.value)} className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.facebookProspects.authorName')}</span>
          <input name="author_name" maxLength={300} value={authorName} onChange={(e) => setAuthorName(e.target.value)} className={FIELD} />
        </label>
        <label>
          <span className={LABEL}>{t('admin.facebookProspects.postUrl')}</span>
          <input name="post_url" type="url" inputMode="url" maxLength={2000} value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://www.facebook.com/groups/…" className={FIELD} />
        </label>
      </div>

      {error ? (
        <p role="alert" className="u-micro rounded-lg bg-danger-tint px-3.5 py-2.5 text-danger">{error}</p>
      ) : null}

      {result ? (
        <div role="status" className="u-micro flex flex-col gap-1 rounded-lg bg-canvas-alt px-3.5 py-3 text-ink-70">
          {result.found ? (
            <>
              <p className="font-semibold text-ink">{t('admin.facebookProspects.saved', { count: result.created.length })}</p>
              {result.created.length ? <p className="u-tabular">{result.created.join(' · ')}</p> : null}
              {result.skipped.map((s) => (
                <p key={s.phone}>
                  <span className="u-tabular">{s.phone}</span> — {t(SKIP_KEYS[s.reason])}
                </p>
              ))}
            </>
          ) : (
            <p>{t('admin.facebookProspects.noneDetected')}</p>
          )}
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="u-btn-primary u-press inline-flex h-10 items-center gap-2 rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white disabled:opacity-60"
        >
          <ClipboardPaste strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {pending ? t('admin.facebookProspects.saving') : t('admin.facebookProspects.submit')}
        </button>
      </div>
    </form>
  );
}
