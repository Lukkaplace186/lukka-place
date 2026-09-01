'use client';

import { useRef, useState, useTransition } from 'react';
import AgentAvatar from './AgentAvatar';
import { uploadAgentAvatarAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';

/**
 * Wraps the read-only AgentAvatar display with a real upload flow. Calls
 * uploadAgentAvatarAction imperatively (via startTransition) rather than a
 * plain <form action> — an avatar picker needs an instant local preview and a
 * true in-flight pending state, neither of which a full-page redirect could
 * give it, unlike every other form on this settings page.
 */
export default function AgentAvatarUpload({ initialSrc }) {
  const [src, setSrc] = useState(initialSrc);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef(null);
  const { showToast } = useToast();

  function handleChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setSrc(previewUrl);

    const formData = new FormData();
    formData.set('avatar', file);

    startTransition(async () => {
      const result = await uploadAgentAvatarAction(formData);
      if (result.ok) {
        setSrc(result.url);
        showToast({ type: 'success', message: 'Photo mise à jour.' });
      } else {
        setSrc(initialSrc);
        showToast({ type: 'error', message: result.error });
      }
      URL.revokeObjectURL(previewUrl);
    });

    event.target.value = '';
  }

  return (
    <div className="flex items-start gap-5">
      <div className="relative h-[6.5rem] w-[6.5rem] shrink-0 overflow-hidden rounded-card bg-canvas-deep">
        <AgentAvatar src={src} alt="" />
        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="u-btn-secondary u-press h-9 rounded-lg px-4 text-xs font-bold text-ink disabled:opacity-60"
        >
          {pending ? 'Envoi en cours…' : 'Changer la photo'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleChange}
        />
        <p className="text-xs text-ink-35">JPEG, PNG ou WebP — 5 Mo max.</p>
      </div>
    </div>
  );
}
