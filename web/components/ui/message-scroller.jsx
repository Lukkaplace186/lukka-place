"use client"

import * as React from "react"
import { AnimatePresence, m } from "motion/react"
import { ArrowDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// shadcn/ui's MessageScroller, without the AI SDK: a chat thread that stays
// pinned to the newest message while the reader is at the bottom, and leaves
// them alone once they scroll up to re-read. Then MessageScrollerButton
// appears (motion) — "Nouveaux messages" when something arrived below — and
// one tap brings them back down. The content is role="log", so a screen
// reader announces what is added.

const ScrollerContext = React.createContext(null)
const PINNED_SLACK = 48 // px from the bottom that still counts as "at the bottom"

function MessageScrollerProvider({ children }) {
  const viewportRef = React.useRef(null)
  const [atBottom, setAtBottom] = React.useState(true)
  const [hasNew, setHasNew] = React.useState(false)
  const scrollToBottom = React.useCallback((behavior = "smooth") => {
    const el = viewportRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
    setHasNew(false)
  }, [])
  const value = React.useMemo(
    () => ({ viewportRef, atBottom, setAtBottom, hasNew, setHasNew, scrollToBottom }),
    [atBottom, hasNew, scrollToBottom]
  )
  return <ScrollerContext.Provider value={value}>{children}</ScrollerContext.Provider>
}

function useScroller() {
  const ctx = React.useContext(ScrollerContext)
  if (!ctx) throw new Error("MessageScroller parts must sit inside <MessageScrollerProvider>")
  return ctx
}

function MessageScroller({ className, ...props }) {
  return <div data-slot="message-scroller" className={cn("relative h-full min-h-0", className)} {...props} />
}

function MessageScrollerViewport({ className, ...props }) {
  const { viewportRef, setAtBottom, setHasNew } = useScroller()
  function onScroll(event) {
    const el = event.currentTarget
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_SLACK
    setAtBottom(bottom)
    if (bottom) setHasNew(false)
  }
  return (
    <div
      ref={viewportRef}
      data-slot="message-scroller-viewport"
      onScroll={onScroll}
      className={cn("h-full overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  )
}

function MessageScrollerContent({ className, ...props }) {
  const { viewportRef, atBottom, setHasNew, scrollToBottom } = useScroller()
  const contentRef = React.useRef(null)
  const pinned = React.useRef(atBottom)
  pinned.current = atBottom

  // Open on the newest message.
  React.useEffect(() => scrollToBottom("auto"), [scrollToBottom])

  // New content: follow it while pinned, otherwise flag it for the button.
  React.useEffect(() => {
    const el = contentRef.current
    if (!el || typeof ResizeObserver === "undefined") return undefined
    let last = el.scrollHeight
    const observer = new ResizeObserver(() => {
      const grew = el.scrollHeight > last
      last = el.scrollHeight
      if (!grew) return
      if (pinned.current) viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
      else setHasNew(true)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [viewportRef, setHasNew])

  return (
    <div
      ref={contentRef}
      data-slot="message-scroller-content"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  )
}

function MessageScrollerButton({ className, label = "Aller aux derniers messages", newLabel = "Nouveaux messages" }) {
  const { atBottom, hasNew, scrollToBottom } = useScroller()
  return (
    <AnimatePresence>
      {!atBottom ? (
        <m.button
          type="button"
          onClick={() => scrollToBottom()}
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
          className={cn(
            "u-focus-ring absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 text-[0.8125rem] font-semibold shadow-lg",
            hasNew ? "text-blue" : "text-ink",
            className
          )}
        >
          <ArrowDownIcon className="size-4" aria-hidden="true" />
          {hasNew ? newLabel : <span className="sr-only">{label}</span>}
        </m.button>
      ) : null}
    </AnimatePresence>
  )
}

export { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport }
