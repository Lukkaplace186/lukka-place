"use client"

import * as React from "react"
import { animate, m, useMotionValue, useReducedMotion } from "motion/react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// shadcn/ui's Carousel API, on motion instead of Embla (no extra package):
// one slide per view, swipe to move (a short fast flick is enough), the
// arrows and the dots move too, and arrow keys work when it has focus. The
// track springs to the slide; reduced motion makes it jump.

const CarouselContext = React.createContext(null)

function useCarousel() {
  const ctx = React.useContext(CarouselContext)
  if (!ctx) throw new Error("Carousel parts must sit inside <Carousel>")
  return ctx
}

function Carousel({ className, children, label = "Photos", ...props }) {
  const [index, setIndex] = React.useState(0)
  const [count, setCount] = React.useState(0)
  const go = React.useCallback((next) => setIndex((current) => Math.max(0, Math.min(count - 1, typeof next === "function" ? next(current) : next))), [count])
  function onKeyDown(event) {
    if (event.key === "ArrowLeft") { event.preventDefault(); go((i) => i - 1) }
    if (event.key === "ArrowRight") { event.preventDefault(); go((i) => i + 1) }
  }
  return (
    <CarouselContext.Provider value={{ index, count, setCount, go }}>
      <div
        data-slot="carousel"
        role="region"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn("u-focus-ring relative outline-none", className)}
        {...props}
      >
        {children}
      </div>
    </CarouselContext.Provider>
  )
}

function CarouselContent({ className, children, ...props }) {
  const { index, setCount, go } = useCarousel()
  const viewportRef = React.useRef(null)
  const x = useMotionValue(0)
  const reduce = useReducedMotion()
  const spring = React.useCallback((to) => (reduce ? (x.set(to), { stop() {} }) : animate(x, to, { type: "spring", stiffness: 320, damping: 34 })), [reduce, x])
  const slides = React.Children.toArray(children)

  React.useEffect(() => setCount(slides.length), [slides.length, setCount])

  // Spring the track to the current slide (and on resize).
  React.useEffect(() => {
    const width = () => viewportRef.current?.offsetWidth || 0
    const controls = spring(-index * width())
    const onResize = () => x.set(-index * width())
    window.addEventListener("resize", onResize)
    return () => {
      controls.stop()
      window.removeEventListener("resize", onResize)
    }
  }, [index, x, spring])

  function onDragEnd(event, info) {
    const width = viewportRef.current?.offsetWidth || 1
    const swipe = info.offset.x + info.velocity.x * 0.2
    if (swipe < -width * 0.2) go((i) => i + 1)
    else if (swipe > width * 0.2) go((i) => i - 1)
    else spring(-index * width)
  }

  return (
    <div ref={viewportRef} data-slot="carousel-content" className={cn("overflow-hidden rounded-2xl", className)} {...props}>
      <m.div className="flex touch-pan-y" style={{ x }} drag="x" dragElastic={0.12} dragMomentum={false} onDragEnd={onDragEnd}>
        {slides}
      </m.div>
    </div>
  )
}

function CarouselItem({ className, ...props }) {
  return <div data-slot="carousel-item" role="group" aria-roledescription="slide" className={cn("min-w-0 shrink-0 grow-0 basis-full select-none", className)} {...props} />
}

function CarouselPrevious({ className, label = "Photo précédente", ...props }) {
  const { index, go } = useCarousel()
  return (
    <button
      type="button"
      data-slot="carousel-previous"
      aria-label={label}
      disabled={index === 0}
      onClick={() => go((i) => i - 1)}
      className={cn("u-focus-ring absolute left-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface/95 text-ink shadow-md disabled:opacity-0", className)}
      {...props}
    >
      <ChevronLeftIcon className="size-5" aria-hidden="true" />
    </button>
  )
}

function CarouselNext({ className, label = "Photo suivante", ...props }) {
  const { index, count, go } = useCarousel()
  return (
    <button
      type="button"
      data-slot="carousel-next"
      aria-label={label}
      disabled={index >= count - 1}
      onClick={() => go((i) => i + 1)}
      className={cn("u-focus-ring absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface/95 text-ink shadow-md disabled:opacity-0", className)}
      {...props}
    >
      <ChevronRightIcon className="size-5" aria-hidden="true" />
    </button>
  )
}

function CarouselDots({ className }) {
  const { index, count, go } = useCarousel()
  if (count < 2) return null
  return (
    <div data-slot="carousel-dots" className={cn("absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5", className)}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i + 1} / ${count}`}
          aria-current={i === index || undefined}
          onClick={() => go(i)}
          className={cn("h-1.5 rounded-full transition-all duration-200", i === index ? "w-5 bg-white" : "w-1.5 bg-white/60")}
        />
      ))}
    </div>
  )
}

export { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, CarouselDots }
