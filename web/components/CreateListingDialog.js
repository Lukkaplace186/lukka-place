'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CloudOff, HardDriveDownload, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { createListingAction } from '@/app/compte/agent/actions';
import { useToast } from './Toast';
import { OPEN_CREATE_LISTING_EVENT, OPEN_CREATE_LISTING_STORAGE_KEY } from '@/lib/agentShortcutEvents';
import { useT } from '@/lib/i18n/client';
import SmartPasteSection from './SmartPasteSection';
import { buildFormValuesFromParsed } from '@/lib/smartPaste';
import { validatePhotoSelection } from '@/lib/uploadLimits.mjs';
import { deleteDraft, fieldsFromForm, isEmptyDraft, loadDraft, looksOffline, saveDraft } from '@/lib/offlineDrafts';
import { shrinkPhotos } from '@/lib/photoShrink';
import { UPGRADE_PATH, announceListingQuota } from '@/lib/listingQuotaRules';

const FIELD_CLASS =
  'u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35';
const LABEL_CLASS = 'mb-1.5 block text-[0.8125rem] font-semibold text-ink-70';

const AUTOSAVE_DELAY_MS = 700;

// The uncontrolled form fields a draft restores, by name.
const DRAFT_FIELDS = ['title', 'reference', 'purpose', 'category_id', 'commune', 'price', 'beds', 'bath', 'area', 'quartier', 'description'];

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
 *
 * OFFLINE DRAFTS (lib/offlineDrafts.js). Agents fill this in on site visits,
 * on a phone, on a connection that drops. So, when `draftKey` is given:
 *  - every change (fields AND photos) is saved to IndexedDB on this device,
 *    and the dialog says so;
 *  - reopening the dialog restores the draft, with a way to discard it;
 *  - "Publier" while offline — or a submit that dies on the network — keeps
 *    the draft and marks it QUEUED instead of losing the form;
 *  - a queued draft is sent as soon as this page is open and online (the
 *    `online` event, or on load), exactly once across tabs (Web Locks), and
 *    flagged `offline_replay` so the server refuses to create it twice when
 *    the first attempt actually reached it before the connection died.
 * A server verdict (a missing field, an invalid price) is NOT a network
 * failure: the draft is un-queued and the dialog reopens with the error.
 */
export default function CreateListingDialog({ communes, categories, draftKey = null, quota = null, primary = false }) {
  const t = useT();
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
  // 'idle' | 'saved' | 'unavailable' — what the device actually did with the last save.
  const [draftState, setDraftState] = useState('idle');
  const [restored, setRestored] = useState(false);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(false);
  const formRef = useRef(null);
  // True once the stored draft (if any) has been applied to the open form, so
  // an autosave can never overwrite a real draft with the still-empty form.
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const syncingRef = useRef(false);
  const router = useRouter();
  const { showToast } = useToast();

  // Refuse before the agent fills in a whole form: the page already knows
  // whether the plan's listing limit is reached (lib/listingQuota.js). The
  // server still re-checks on submit.
  function openForm() {
    if (quota?.atLimit) {
      announceListingQuota({ limit: quota.limit, used: quota.used, plan: quota.planTitle, upgradeHref: UPGRADE_PATH });
      return;
    }
    setOpen(true);
  }

  useEffect(() => {
    function handleShortcut() {
      openForm();
    }
    window.addEventListener(OPEN_CREATE_LISTING_EVENT, handleShortcut);
    return () => window.removeEventListener(OPEN_CREATE_LISTING_EVENT, handleShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openForm only reads `quota`
  }, [quota]);

  // ---------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------

  const persistDraft = useCallback(
    async ({ queued: markQueued = false, photoList } = {}) => {
      if (!draftKey) return false;
      const draft = {
        fields: fieldsFromForm(formRef.current),
        photos: (photoList || []).map(({ file }) => ({ name: file.name, type: file.type, blob: file })),
        queued: markQueued,
      };
      if (!markQueued && isEmptyDraft(draft)) {
        await deleteDraft(draftKey);
        setDraftState('idle');
        return true;
      }
      const ok = await saveDraft(draftKey, draft);
      setDraftState(ok ? 'saved' : 'unavailable');
      return ok;
    },
    [draftKey],
  );

  function scheduleAutosave(photoList = photos) {
    if (!draftKey || !hydratedRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistDraft({ photoList });
    }, AUTOSAVE_DELAY_MS);
  }

  // Restore on open. The form is mounted by the time an effect runs.
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      return undefined;
    }
    if (!draftKey) {
      hydratedRef.current = true;
      return undefined;
    }
    let cancelled = false;
    loadDraft(draftKey).then((draft) => {
      if (cancelled) return;
      if (draft && !isEmptyDraft(draft)) {
        const form = formRef.current;
        for (const name of DRAFT_FIELDS) {
          if (form?.elements[name] && draft.fields?.[name] != null) form.elements[name].value = draft.fields[name];
        }
        const restoredPhotos = (draft.photos || [])
          .filter((p) => p?.blob)
          .map((p) => {
            const file = new File([p.blob], p.name || 'photo.jpg', { type: p.type || p.blob.type });
            return { file, url: URL.createObjectURL(file) };
          });
        setPhotos(restoredPhotos);
        setRestored(true);
        setDraftState('saved');
      }
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [open, draftKey]);

  // Online/offline indicator + the queued-draft sync.
  const syncQueuedDraft = useCallback(async () => {
    if (!draftKey || syncingRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    const run = async () => {
      const draft = await loadDraft(draftKey);
      if (!draft?.queued) {
        setQueued(false);
        return;
      }
      setQueued(true);
      syncingRef.current = true;
      try {
        const formData = new FormData();
        for (const [name, value] of Object.entries(draft.fields || {})) formData.set(name, value);
        for (const p of draft.photos || []) {
          if (p?.blob) formData.append('photos', new File([p.blob], p.name || 'photo.jpg', { type: p.type || p.blob.type }));
        }
        formData.set('offline_replay', '1');

        let result;
        try {
          result = await createListingAction(communes, categories, formData);
        } catch (err) {
          if (looksOffline(err)) return; // still offline — stays queued for the next `online`
          throw err;
        }

        if (result?.ok) {
          await deleteDraft(draftKey);
          setQueued(false);
          setDraftState('idle');
          showToast({ type: 'success', message: t('agent.drafts.synced') });
          router.refresh();
        } else {
          await saveDraft(draftKey, { ...draft, queued: false });
          setQueued(false);
          showToast({ type: 'error', message: t('agent.drafts.syncRejected', { error: result?.error || '' }) });
          setOpen(true);
        }
      } catch (err) {
        console.error('[CreateListingDialog] queued draft sync failed', err);
      } finally {
        syncingRef.current = false;
      }
    };

    // One tab sends it; another tab that comes online at the same moment
    // finds the lock taken and does nothing.
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      await navigator.locks.request(`lukka-sync:${draftKey}`, { ifAvailable: true }, async (lock) => {
        if (lock) await run();
      });
    } else {
      await run();
    }
  }, [draftKey, communes, categories, router, showToast, t]);

  useEffect(() => {
    function handleOnline() {
      setOffline(false);
      syncQueuedDraft();
    }
    function handleOffline() {
      setOffline(true);
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    // An initial check, deferred so it is not a synchronous setState in the effect body.
    const initial = setTimeout(() => {
      setOffline(navigator.onLine === false);
      syncQueuedDraft();
    }, 0);
    return () => {
      clearTimeout(initial);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncQueuedDraft]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  async function queueForLater(photoList) {
    clearTimeout(saveTimerRef.current);
    const ok = await persistDraft({ queued: true, photoList });
    if (!ok) {
      showToast({ type: 'error', message: t('agent.drafts.cannotSaveOffline') });
      return;
    }
    setQueued(true);
    showToast({ type: 'success', message: t('agent.drafts.queued') });
    closeWithoutDiscarding();
  }

  async function handleDiscardDraft() {
    clearTimeout(saveTimerRef.current);
    if (draftKey) await deleteDraft(draftKey);
    resetForm();
    setRestored(false);
    setQueued(false);
    setDraftState('idle');
    showToast({ type: 'success', message: t('agent.drafts.discarded') });
  }

  // ---------------------------------------------------------------------
  // Form
  // ---------------------------------------------------------------------

  const [optimizingPhotos, setOptimizingPhotos] = useState(false);

  // Photos are shrunk on the phone before they are previewed, saved to the
  // offline draft or uploaded — lib/photoShrink.js. A 4 MB camera JPEG
  // becomes ~300 KB, which is the difference between a publish that takes
  // seconds and one that takes minutes on a Kinshasa 3G uplink.
  async function handlePhotoChange(event) {
    const input = event.target;
    const picked = Array.from(input.files || []);
    input.value = '';
    if (!picked.length) return;
    setOptimizingPhotos(true);
    let shrunk;
    try {
      shrunk = await shrinkPhotos(picked);
    } finally {
      setOptimizingPhotos(false);
    }
    const files = shrunk.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => {
      const next = [...prev, ...files];
      scheduleAutosave(next);
      return next;
    });
  }

  function removePhoto(index) {
    URL.revokeObjectURL(photos[index].url);
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    scheduleAutosave(next);
  }

  function resetForm() {
    formRef.current?.reset();
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
  }

  /** Closing keeps the stored draft; only a successful publish or "discard" removes it. */
  function closeWithoutDiscarding() {
    clearTimeout(saveTimerRef.current);
    setOpen(false);
    setRestored(false);
    resetForm();
  }

  /**
   * Fills the (entirely uncontrolled) form fields directly on the DOM node,
   * same reasoning as a plain `form.reset()` above — there's no controlled
   * state for these inputs to flow through. Only fields the extraction
   * actually returned are touched, so a partial paste never clears something
   * the agent had already typed by hand.
   */
  function handleParsed(extracted, rawText) {
    const mapped = buildFormValuesFromParsed(extracted, { communes, categories, rawText });
    const form = formRef.current;
    if (!form) return;

    if (mapped.title) form.elements.title.value = mapped.title;
    if (mapped.purpose) form.elements.purpose.value = mapped.purpose;
    if (mapped.categoryId != null) form.elements.category_id.value = String(mapped.categoryId);
    if (mapped.commune) form.elements.commune.value = mapped.commune;
    if (mapped.price) form.elements.price.value = mapped.price;
    if (mapped.beds) form.elements.beds.value = mapped.beds;
    if (mapped.bath) form.elements.bath.value = mapped.bath;
    if (mapped.area) form.elements.area.value = mapped.area;
    if (mapped.quartier) form.elements.quartier.value = mapped.quartier;
    if (mapped.reference) form.elements.reference.value = mapped.reference;
    if (mapped.description) form.elements.description.value = mapped.description;
    scheduleAutosave();
  }

  function handleSubmit(event) {
    event.preventDefault();
    const files = photos.map(({ file }) => file);

    // Checked here, before a single byte goes out, using the same rule the
    // Server Action re-checks (lib/uploadLimits.mjs). Over the transport
    // ceiling the request is aborted with a 413 mid-upload, which reaches
    // this component as a rejected fetch carrying nothing an agent could
    // act on — so the size verdict has to be reached while the file list is
    // still in hand and can be named precisely.
    const problem = validatePhotoSelection(files);
    if (problem) {
      showToast({ type: 'error', message: t(problem.key, problem.vars) });
      return;
    }

    // No connection: don't even try. Keep everything on the device, send later.
    if (draftKey && navigator.onLine === false) {
      queueForLater(photos);
      return;
    }

    const formData = new FormData(formRef.current);
    formData.delete('photos');
    for (const file of files) formData.append('photos', file);
    const photoSnapshot = photos;

    startTransition(async () => {
      let result;
      try {
        result = await createListingAction(communes, categories, formData);
      } catch (err) {
        // A Server Action can fail *as a request* — an expired session
        // throwing server-side, a dropped connection, a body the transport
        // refused — and that arrives as a rejected promise, never as an
        // {ok:false} the branch below could read. Without this catch the
        // rejection went unhandled and the agent got a button that did
        // nothing at all: no toast, no error, form still full. That is the
        // symptom this whole fix started from.
        console.error('[CreateListingDialog] createListingAction failed', err);
        if (draftKey && looksOffline(err)) {
          await queueForLater(photoSnapshot);
          return;
        }
        showToast({ type: 'error', message: t('errors.submissionFailed') });
        return;
      }

      if (!result.ok) {
        // The plan's listing limit: the draft stays, the dialog explains and
        // offers the upgrade instead of a toast that vanishes.
        if (result.quota) {
          announceListingQuota(result.quota);
          return;
        }
        showToast({ type: 'error', message: result.error });
        return;
      }
      if (draftKey) await deleteDraft(draftKey);
      setDraftState('idle');
      showToast({
        type: result.photoWarning ? 'error' : 'success',
        message: result.photoWarning
          ? t('agent.editor.createdWithPhotoWarning')
          : t('agent.editor.createdPendingReview'),
      });
      closeWithoutDiscarding();
      router.refresh();
    });
  }

  let draftLine = null;
  if (draftKey && offline) {
    draftLine = { icon: CloudOff, text: t('agent.drafts.offline'), tone: 'text-warning' };
  } else if (draftKey && draftState === 'saved') {
    draftLine = { icon: HardDriveDownload, text: t('agent.drafts.savedLocally'), tone: 'text-ink-45' };
  } else if (draftKey && draftState === 'unavailable') {
    draftLine = { icon: CloudOff, text: t('agent.drafts.storageUnavailable'), tone: 'text-ink-45' };
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setOpen(true); else closeWithoutDiscarding(); }}>
      <div className="flex items-center gap-2">
        {queued && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-canvas-alt px-3 text-xs font-semibold text-ink-70" role="status">
            <CloudOff strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
            {t('agent.drafts.queuedPill')}
          </span>
        )}
        <button
          type="button"
          onClick={openForm}
          className={
            primary
              ? 'u-btn-primary u-press inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue px-3 text-[0.8125rem] font-bold text-white sm:h-11 sm:px-5 sm:text-sm'
              : 'u-btn-secondary u-press inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[0.8125rem] font-bold text-ink'
          }
        >
          <Plus strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('agent.editor.addListing')}
        </button>
      </div>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('agent.editor.addListing')}</DialogTitle>
          <DialogDescription>
            {t('agent.editor.publicAfterReview')}
          </DialogDescription>
        </DialogHeader>

        {(draftLine || restored) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-canvas-alt px-3 py-2 text-xs">
            {draftLine ? (
              <span className={`inline-flex items-center gap-1.5 font-semibold ${draftLine.tone}`} role="status" aria-live="polite">
                <draftLine.icon strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                {draftLine.text}
              </span>
            ) : <span />}
            {restored && (
              <span className="inline-flex items-center gap-2 text-ink-45">
                {t('agent.drafts.restored')}
                <button type="button" onClick={handleDiscardDraft} className="font-semibold text-blue-deep underline">
                  {t('agent.drafts.discard')}
                </button>
              </span>
            )}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} onInput={() => scheduleAutosave()} className="flex flex-col gap-4">
          <SmartPasteSection onParsed={handleParsed} />

          <div>
            <label htmlFor="title" className={LABEL_CLASS}>Titre</label>
            <input id="title" name="title" required maxLength={150} placeholder={t('agent.editor.titlePlaceholder')} className={FIELD_CLASS} />
          </div>

          <div>
            <label htmlFor="reference" className={LABEL_CLASS}>{t('agent.editor.reference')}</label>
            <input
              id="reference"
              name="reference"
              maxLength={120}
              placeholder={t('agent.editor.referencePlaceholder')}
              className={FIELD_CLASS}
            />
            <p className="mt-1 text-xs text-ink-35">{t('agent.editor.referenceHint')}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="purpose" className={LABEL_CLASS}>{t('common.shared.transaction')}</label>
              <select id="purpose" name="purpose" required defaultValue="" className={FIELD_CLASS}>
                <option value="" disabled>{t('common.shared.choose')}</option>
                <option value="rent">{t('common.shared.rentVerb')}</option>
                <option value="sale">{t('common.shared.sellVerb')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="category_id" className={LABEL_CLASS}>{t('agent.editor.propertyType')}</label>
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
              <label htmlFor="price" className={LABEL_CLASS}>{t('agent.editor.priceUsd')}</label>
              <input id="price" name="price" type="number" min="1" step="1" required className={FIELD_CLASS} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="beds" className={LABEL_CLASS}>Chambres</label>
              <input id="beds" name="beds" type="number" min="0" step="1" className={FIELD_CLASS} />
            </div>
            <div>
              <label htmlFor="bath" className={LABEL_CLASS}>{t('agent.editor.bathrooms')}</label>
              <input id="bath" name="bath" type="number" min="0" step="1" className={FIELD_CLASS} />
            </div>
          </div>

          {/* Surface and quartier were the two fields the WhatsApp intake
              captured and this form did not, so a listing typed here was
              permanently thinner than the same listing sent by message:
              "0 m²" on the card, and invisible to the quartier filter. Both
              optional — an agent who doesn't know the surface leaves it
              empty and the card shows nothing, rather than a fabricated 0. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="area" className={LABEL_CLASS}>Superficie (m²)</label>
              <input id="area" name="area" type="number" min="1" step="1" className={FIELD_CLASS} />
            </div>
            <div>
              <label htmlFor="quartier" className={LABEL_CLASS}>{t('listings.filters.quartier')}</label>
              <input id="quartier" name="quartier" maxLength={120} className={FIELD_CLASS} />
            </div>
          </div>

          <div>
            <label htmlFor="description" className={LABEL_CLASS}>{t('listings.detail.description')}</label>
            <textarea
              id="description"
              name="description"
              required
              minLength={15}
              rows={4}
              placeholder={t('agent.editor.descriptionPlaceholder')}
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
                    aria-label={t('agent.editor.removePhoto')}
                    className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white"
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
            <p className="mt-1.5 text-xs text-ink-35" role={optimizingPhotos ? 'status' : undefined}>
              {optimizingPhotos ? t('agent.editor.optimizingPhotos') : t('agent.editor.photoHint')}
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="u-press inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink">
                {t('common.actions.cancel')}
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending}
              className="u-btn-primary u-press h-11 rounded-lg bg-blue px-5 text-sm font-bold text-white disabled:opacity-60"
            >
              {pending ? 'Publication en cours…' : offline && draftKey ? t('agent.drafts.publishWhenOnline') : 'Publier l’annonce'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
