'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { createListingAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';
import { OPEN_CREATE_LISTING_EVENT, OPEN_CREATE_LISTING_STORAGE_KEY } from '@/lib/agentShortcutEvents';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';
const LABEL_CLASS = 'mb-1.5 block text-[0.8125rem] font-semibold text-ink-70';

/**
 * The agent-side "manually create a listing" form — real DB-backed
 * category/commune options (never hardcoded), a required multi-photo
 * upload with local previews, and an imperative call to createListingAction
 * (not a plain <form action>) so this stays open and shows the real error on
 * a validation failure instead of navigating away.
 *
 * Also the real destination of the global "N" keyboard shortcut
 * (AgentKeyboardShortcuts.js): there is no dedicated `/biens/nouveau`
 * *page* — creation has always been this in-place dialog, not a route — so
 * "N" opens this instead of navigating to a page that doesn't exist. Two
 * paths in:
 *  - Already on Mes biens: AgentKeyboardShortcuts dispatches
 *    OPEN_CREATE_LISTING_EVENT and this opens immediately.
 *  - Anywhere else: it sets a one-shot sessionStorage flag and navigates to
 *    Mes biens; the flag is consumed in the lazy useState initializer below
 *    (a read during render, not a setState-in-effect — the ESLint rule
 *    other 'use client' components in this app already trip over,
 *    react-hooks/set-state-in-effect, exists for exactly this: calling
 *    setState synchronously inside an effect body cascades into an extra
 *    render). sessionStorage rather than a `?new=1` query param on purpose
 *    — `useSearchParams()` would force a Suspense boundary around this
 *    component (see web/CLAUDE.md's documented gotcha).
 */
export default function CreateListingDialog({ communes, categories }) {
  // Lazy initializer: reads (and clears) the one-shot flag exactly once, at
  // first render — not in an effect. `typeof window` guards the server
  // render, which always computes `false` since sessionStorage doesn't
  // exist there; only the client's real first mount ever sees the flag.
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      if (window.sessionStorage.getItem(OPEN_CREATE_LISTING_STORAGE_KEY) === '1') {
        window.sessionStorage.removeItem(OPEN_CREATE_LISTING_STORAGE_KEY);
        return true;
      }
    } catch {
      // Private-browsing sessionStorage access can throw — the shortcut
      // simply doesn't auto-open in that case, no crash.
    }
    return false;
  });
  const [pending, startTransition] = useTransition();
  const [photos, setPhotos] = useState([]);
  const formRef = useRef(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    function handleShortcut() {
      setOpen(true);
    }
    window.addEventListener(OPEN_CREATE_LISTING_EVENT, handleShortcut);
    return () => window.removeEventListener(OPEN_CREATE_LISTING_EVENT, handleShortcut);
  }, []);

  function handlePhotoChange(event) {
    const files = Array.from(event.target.files || []).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...files]);
    event.target.value = '';
  }

  function removePhoto(index) {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  }

  function resetForm() {
    formRef.current?.reset();
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(formRef.current);
    formData.delete('photos');
    for (const { file } of photos) formData.append('photos', file);

    startTransition(async () => {
      const result = await createListingAction(communes, categories, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({
        type: result.photoWarning ? 'error' : 'success',
        message: result.photoWarning
          ? 'Annonce créée, mais certaines photos n’ont pas pu être envoyées.'
          : 'Annonce créée — en attente de validation par l’équipe Lukka Place.',
      });
      setOpen(false);
      resetForm();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) resetForm(); }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-btn-secondary u-press inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[0.8125rem] font-bold text-ink"
      >
        <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        Ajouter un bien
      </button>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ajouter un bien</DialogTitle>
          <DialogDescription>
            Votre annonce sera visible publiquement après validation par l’équipe Lukka Place.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="title" className={LABEL_CLASS}>Titre</label>
            <input id="title" name="title" required maxLength={150} placeholder="Bel appartement 3 chambres à Gombe" className={FIELD_CLASS} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="purpose" className={LABEL_CLASS}>Transaction</label>
              <select id="purpose" name="purpose" required defaultValue="" className={FIELD_CLASS}>
                <option value="" disabled>Choisir…</option>
                <option value="rent">Louer</option>
                <option value="sale">Vendre</option>
              </select>
            </div>
            <div>
              <label htmlFor="category_id" className={LABEL_CLASS}>Type de bien</label>
              <select id="category_id" name="category_id" required defaultValue="" className={FIELD_CLASS}>
                <option value="" disabled>Choisir…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="commune" className={LABEL_CLASS}>Commune</label>
              <select id="commune" name="commune" required defaultValue="" className={FIELD_CLASS}>
                <option value="" disabled>Choisir…</option>
                {communes.map((commune) => (
                  <option key={commune} value={commune}>{commune}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="price" className={LABEL_CLASS}>Prix ($)</label>
              <input id="price" name="price" type="number" min="1" step="1" required className={FIELD_CLASS} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="beds" className={LABEL_CLASS}>Chambres</label>
              <input id="beds" name="beds" type="number" min="0" step="1" className={FIELD_CLASS} />
            </div>
            <div>
              <label htmlFor="bath" className={LABEL_CLASS}>Salles de bain</label>
              <input id="bath" name="bath" type="number" min="0" step="1" className={FIELD_CLASS} />
            </div>
          </div>

          <div>
            <label htmlFor="description" className={LABEL_CLASS}>Description</label>
            <textarea
              id="description"
              name="description"
              required
              minLength={15}
              rows={4}
              placeholder="Décrivez le bien : état, équipements, environnement…"
              className="u-focus-ring w-full resize-y rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-ink-35"
            />
          </div>

          <div>
            <span className={LABEL_CLASS}>Photos</span>
            <div className="flex flex-wrap gap-2.5">
              {photos.map(({ file, url }, index) => (
                <div key={`${file.name}-${index}`} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-canvas-deep">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    aria-label="Retirer cette photo"
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
                  >
                    <X strokeWidth={2.5} className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="grid h-20 w-20 shrink-0 cursor-pointer place-items-center rounded-lg border border-dashed border-line text-ink-45 hover:bg-canvas-alt">
                <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={handlePhotoChange} />
              </label>
            </div>
            <p className="mt-1.5 text-xs text-ink-35">JPEG, PNG ou WebP — 5 Mo max par photo, 10 photos max.</p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink">
                Annuler
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? 'Publication en cours…' : 'Publier l’annonce'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
