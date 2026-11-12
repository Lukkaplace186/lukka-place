"use client"

import * as React from "react"
import { m } from "motion/react"

import { cn } from "@/lib/utils"

// shadcn/ui's Marker: a centred system line in a thread ("Aujourd’hui",
// "L’agent écrit…"). MarkerTyping is the three-dot indicator: motion bobs
// the dots, and nothing moves for a phone set to reduce motion.

function Marker({ className, ...props }) {
  return <div data-slot="marker" className={cn("flex justify-center py-1", className)} {...props} />
}

function MarkerContent({ className, ...props }) {
  return <div data-slot="marker-content" className={cn("flex items-center gap-2 rounded-full bg-canvas-alt px-3 py-1 text-[0.75rem] text-ink-45", className)} {...props} />
}

function MarkerTyping({ className }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center gap-0.5", className)}>
      {[0, 1, 2].map((i) => (
        <m.span
          key={i}
          className="block size-1.5 rounded-full bg-ink-45"
          animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  )
}

export { Marker, MarkerContent, MarkerTyping }
