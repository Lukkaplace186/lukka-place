'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Star, Trash2, X } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * The listing editor's photo grid (2026-09-28). Order IS the gallery order,
 * and #1 is the cover (featured_image) every card and share preview uses.
 *
 * - **Drag works on a phone.** The grid it replaced used HTML5 drag and drop,
 *   which iOS and Android browsers never fire from a finger, so on the phones
 *   agents actually use there was no way to reorder at all. dnd-kit's
 *   TouchSensor starts a drag after a short hold (DRAG_DELAY_MS) and lets an
 *   ordinary swipe still scroll the page; the mouse drags after a few pixels;
 *   the keyboard (Space, arrows, Space) works too.
 * - **Every tile carries its position** (1, 2, 3…), so "which one is second
 *   on the listing?" never needs guessing.
 * - **A tap opens the tile's own two actions**: "Mettre en couverture" (moves
 *   it to #1) and "Supprimer". The always-visible × is gone — on a 3-column
 *   phone grid it sat under the thumb during every drag.
 *
 * `photos` are `{ id, url, file }`; `id` must be stable across reorders
 * (dnd-kit tracks items by it), which `url` alone is not for two identical
 * uploads — the editor gives new files their object URL, unique per file.
 */
const DRAG_DELAY_MS = 180;

export default function AgentPhotoSorter({ photos, onChange }) {
  const t = useT();
  const [menuFor, setMenuFor] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const justDragged = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: DRAG_DELAY_MS, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // A tap anywhere outside the open tile closes its menu.
  useEffect(() => {
    if (menuFor == null) return undefined;
    const close = (event) => {
      if (!event.target.closest?.(`[data-photo-id="${CSS.escape(menuFor)}"]`)) setMenuFor(null);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [menuFor]);

  function handleDragEnd({ active, over }) {
    setActiveId(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 150);
    if (!over || active.id === over.id) return;
    const from = photos.findIndex((p) => p.id === active.id);
    const to = photos.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(photos, from, to));
  }

  function makeCover(id) {
    const from = photos.findIndex((p) => p.id === id);
    if (from > 0) onChange(arrayMove(photos, from, 0));
    setMenuFor(null);
  }

  function remove(id) {
    onChange(photos.filter((p) => p.id !== id));
    setMenuFor(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => {
        setMenuFor(null);
        setActiveId(active.id);
      }}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
          {photos.map((photo, index) => (
            <SortablePhoto
              key={photo.id}
              photo={photo}
              index={index}
              dragging={activeId === photo.id}
              menuOpen={menuFor === photo.id}
              onTap={() => {
                if (justDragged.current) return;
                setMenuFor((current) => (current === photo.id ? null : photo.id));
              }}
              onCover={() => makeCover(photo.id)}
              onRemove={() => remove(photo.id)}
              onClose={() => setMenuFor(null)}
              t={t}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortablePhoto({ photo, index, dragging, menuOpen, onTap, onCover, onRemove, onClose, t }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: photo.id });
  const isCover = index === 0;

  return (
    <li
      ref={setNodeRef}
      data-photo-id={photo.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative aspect-square select-none overflow-hidden rounded-lg bg-canvas-deep ${
        dragging ? 'z-10 scale-105 shadow-lg ring-2 ring-blue' : ''
      } ${isCover ? 'ring-2 ring-blue' : ''}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={onTap}
        aria-label={t('agent.editor.photoPosition', { n: index + 1 })}
        aria-expanded={menuOpen}
        // `manipulation`, not `none`: a quick swipe over the grid must still
        // scroll the page — only a held finger (TouchSensor delay) drags.
        className="block h-full w-full cursor-grab touch-manipulation [-webkit-touch-callout:none] active:cursor-grabbing"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" />
      </button>

      <span
        aria-hidden="true"
        className="u-tabular pointer-events-none absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-black/65 px-1.5 text-[0.75rem] font-bold text-white"
      >
        {index + 1}
      </span>

      {isCover && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 inline-flex items-center justify-center gap-1 bg-blue/90 py-0.5 text-[0.6875rem] font-bold text-white">
          <Star strokeWidth={2.5} className="h-3 w-3" aria-hidden="true" />
          {t('agent.editor.cover')}
        </span>
      )}

      {menuOpen && (
        <div className="absolute inset-0 flex flex-col items-stretch justify-center gap-1.5 bg-ink/75 p-1.5">
          {!isCover && (
            <button
              type="button"
              onClick={onCover}
              className="u-press inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-white px-1.5 text-[0.75rem] font-bold text-ink"
            >
              <Star strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0" />
              {t('agent.editor.makeCover')}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="u-press inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-danger px-1.5 text-[0.75rem] font-bold text-white"
          >
            <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5 shrink-0" />
            {t('agent.editor.removePhotoShort')}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.actions.close')}
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full text-white/80 hover:text-white"
          >
            <X strokeWidth={2.5} className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}
