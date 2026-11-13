'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, LazyMotion, MotionConfig } from 'motion/react';
import * as m from 'motion/react-m';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const loadFeatures = () => import('./guideCardFeatures').then((mod) => mod.default);

// The card's photo keeps the SAME pixel size closed and open (the open card's
// width × header height), and the closed tile only shows a window of it. That
// is what lets the photo travel with the card without stretching: a layout
// animation is a transform, and a box that changes shape distorts what is in it.
// The title box keeps one width for the same reason. CSS variables, so the
// tile and the open card read the same numbers at every breakpoint.
const SIZES = '[--gc-w:100vw] [--gc-h:90vw] [--gc-title:calc(100vw-72px)] sm:[--gc-w:45rem] sm:[--gc-h:24rem] sm:[--gc-title:19rem]';
const RADIUS = 20;
const SPRING = { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 };
const IMAGE_SIZES = '(min-width: 640px) 720px, 100vw';

/**
 * /guides as App Store "Today" cards: a tap lifts the card into a full panel
 * (photo, title, summary, the article's opening) with "Lire l'article
 * complet" underneath. Each card stays a real link to /guides/<slug>, so a
 * crawler, a new-tab click or a phone before hydration simply opens the
 * article. Motion is loaded on this page only, its layout features lazily.
 *
 * `articles`: [{ slug, title, summary, intro, eyebrow, coverUrl, coverAlt, lang }]
 */
export default function GuideCards({ articles, labels }) {
  const [openSlug, setOpenSlug] = useState(null);
  const [phone, setPhone] = useState(false);
  const tileRefs = useRef(new Map());
  const pushedRef = useRef(false);
  const open = articles.find((a) => a.slug === openSlug) || null;

  const openCard = useCallback((event, slug) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setPhone(window.matchMedia('(max-width: 639px)').matches);
    setOpenSlug(slug);
    // An entry in the history, so Android's back button closes the card
    // instead of leaving the page. Next keeps its own state on it.
    try {
      window.history.pushState(null, '', `#${slug}`);
      pushedRef.current = true;
    } catch {
      pushedRef.current = false;
    }
  }, []);

  const close = useCallback(() => {
    if (pushedRef.current) {
      window.history.back(); // the popstate below closes the card
      return;
    }
    setOpenSlug(null);
  }, []);

  useEffect(() => {
    if (!openSlug) return undefined;
    const slug = openSlug;
    const onPop = () => {
      pushedRef.current = false;
      setOpenSlug(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      root.style.overflow = previousOverflow;
      // Back on the card that was opened, for a keyboard or screen reader.
      tileRefs.current.get(slug)?.focus({ preventScroll: true });
    };
  }, [openSlug, close]);

  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={SPRING}>
        <ul className={cn('grid gap-4 sm:grid-cols-2 sm:gap-5', SIZES)}>
          {articles.map((a, i) => (
            <li key={a.slug} className={i === 0 ? 'sm:col-span-2' : undefined}>
              <Link
                ref={(el) => {
                  if (el) tileRefs.current.set(a.slug, el);
                  else tileRefs.current.delete(a.slug);
                }}
                href={`/guides/${a.slug}`}
                onClick={(e) => openCard(e, a.slug)}
                aria-haspopup="dialog"
                className="group block h-[80vw] rounded-[20px] outline-offset-4 transition-transform duration-200 ease-out active:scale-[0.97] sm:h-[22rem]"
              >
                {openSlug === a.slug ? null : <Tile article={a} priority={i === 0} />}
              </Link>
            </li>
          ))}
        </ul>

        <AnimatePresence>
          {open ? <OpenCard key={open.slug} article={open} labels={labels} phone={phone} onClose={close} /> : null}
        </AnimatePresence>
      </MotionConfig>
    </LazyMotion>
  );
}

function Tile({ article: a, priority }) {
  return (
    <m.div
      layoutId={`gc-card-${a.slug}`}
      style={{ borderRadius: RADIUS }}
      className={cn(
        'relative h-full w-full overflow-hidden shadow-[0_1px_2px_rgb(12_29_80/0.08),0_8px_24px_-12px_rgb(12_29_80/0.35)]',
        a.coverUrl ? 'bg-white ring-1 ring-inset ring-[rgb(12_29_80/0.08)]' : 'bg-[var(--blue-900)]',
      )}
    >
      <Media article={a} priority={priority} />
      <Heading article={a} />
      {/* A cover is the picture under the title, like the App Store; without one the
          summary fills the card. The open card always shows it. */}
      {a.summary && !a.coverUrl ? (
        <m.div layout="position" className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,rgb(0_0_0/0.62)_0%,rgb(0_0_0/0.38)_55%,rgb(0_0_0/0)_100%)] p-5 pt-14">
          <p lang={a.lang} className="line-clamp-2 text-[0.875rem] leading-snug text-white/90">
            {a.summary}
          </p>
        </m.div>
      ) : null}
    </m.div>
  );
}

function OpenCard({ article: a, labels, phone, onClose }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  // Keep Tab inside the panel while it is open.
  const onKeyDown = (e) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll('a[href], button:not([disabled])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <m.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.2 } }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
        className="fixed inset-0 z-[70] bg-[rgb(12_29_80/0.45)]"
        aria-hidden="true"
      />
      <div className={cn('pointer-events-none fixed inset-0 z-[71] flex justify-center sm:items-center sm:p-6', SIZES)}>
        <m.div
          ref={panelRef}
          layoutId={`gc-card-${a.slug}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`gc-title-${a.slug}`}
          onKeyDown={onKeyDown}
          style={{ borderRadius: phone ? 0 : RADIUS }}
          className="pointer-events-auto relative flex h-full w-full flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:max-w-[45rem]"
        >
          <m.div layoutScroll className="flex-1 overflow-y-auto overscroll-contain">
            <div className={cn('relative h-[var(--gc-h)] w-full shrink-0 overflow-hidden', a.coverUrl ? 'bg-white' : 'bg-[var(--blue-900)]')}>
              <Media article={a} />
              <Heading article={a} />
            </div>
            <m.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.12, duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              className="px-5 pb-8 pt-6 sm:px-8 sm:pb-10 sm:pt-7"
              lang={a.lang}
            >
              {a.summary ? <p className="text-[1.0625rem] font-medium leading-relaxed text-ink">{a.summary}</p> : null}
              {a.intro ? (
                <div className="relative mt-4">
                  <p className="whitespace-pre-line text-[0.9375rem] leading-relaxed text-ink-70">{a.intro}</p>
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface to-transparent" />
                </div>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
                <Link
                  href={`/guides/${a.slug}`}
                  replace
                  className="u-btn-primary inline-flex min-h-11 items-center gap-2 rounded-full bg-blue px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-deep"
                >
                  {labels.readFull}
                  <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                </Link>
                {a.readingTime ? <span className="text-[0.8125rem] text-ink-45">{a.readingTime}</span> : null}
              </div>
            </m.div>
          </m.div>

          <m.button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1, transition: { delay: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-[rgb(12_29_80/0.55)] text-white outline-offset-2 hover:bg-[rgb(12_29_80/0.75)]"
          >
            <X className="size-[18px]" strokeWidth={2.25} aria-hidden="true" />
          </m.button>
        </m.div>
      </div>
    </>
  );
}

/** The photo (or the brand-blue ground when the article has none), same size open and closed. */
function Media({ article: a, priority = false }) {
  return (
    <m.div
      layoutId={`gc-media-${a.slug}`}
      className="absolute top-0 h-[var(--gc-h)] w-[var(--gc-w)]"
      style={{ left: 'calc(50% - var(--gc-w) / 2)' }}
    >
      {a.coverUrl ? (
        <Image src={a.coverUrl} alt={a.coverAlt || ''} fill sizes={IMAGE_SIZES} priority={priority} className="object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(120%_90%_at_15%_0%,var(--blue-400)_0%,var(--blue)_45%,var(--blue-900)_100%)]"
        />
      )}
      {/* Keeps the title readable. Covers are drawn on white (content/blog/images/src), so
          over a cover the title is ink on a white fade, which also holds on any photo; the
          blue ground without a cover keeps a white title on a dark fade. The tile's summary
          carries its own gradient, so the open card shows the picture's lower half untouched. */}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0',
          a.coverUrl
            ? 'bg-[linear-gradient(to_bottom,rgb(255_255_255/0.88)_0%,rgb(255_255_255/0.6)_22%,rgb(255_255_255/0)_42%)]'
            : 'bg-[linear-gradient(to_bottom,rgb(0_0_0/0.42)_0%,rgb(0_0_0/0)_40%)]',
        )}
      />
    </m.div>
  );
}

function Heading({ article: a }) {
  return (
    <m.div layoutId={`gc-head-${a.slug}`} className={cn('absolute left-5 top-5 w-[var(--gc-title)]', a.coverUrl ? 'text-ink' : 'text-white')}>
      {a.eyebrow ? (
        <p className={cn('text-[0.6875rem] font-semibold uppercase tracking-[0.1em]', a.coverUrl ? 'text-blue-deep' : 'text-white/80')}>{a.eyebrow}</p>
      ) : null}
      <h2 id={`gc-title-${a.slug}`} lang={a.lang} className="mt-1.5 text-[1.375rem] font-bold leading-[1.18] tracking-[-0.01em] [text-wrap:balance]">
        {a.title}
      </h2>
    </m.div>
  );
}
