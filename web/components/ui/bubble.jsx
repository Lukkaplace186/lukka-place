"use client"

import * as React from "react"
import { m } from "motion/react"

import { cn } from "@/lib/utils"

// shadcn/ui's Bubble for Lukka Place's chat (Messagerie). `align="end"` is
// the reader's own message, royal blue; `variant="muted"` is the other
// person's, white with a hairline. `appear` springs a bubble in — only for a
// message that just arrived; a thread already on the page never animates.

const BubbleContext = React.createContext({ align: "start", variant: "default" })

function BubbleGroup({ className, ...props }) {
  return <div data-slot="bubble-group" className={cn("flex flex-col gap-1", className)} {...props} />
}

function Bubble({ className, align = "start", variant, appear = false, children, ...props }) {
  const resolved = variant || (align === "end" ? "default" : "muted")
  return (
    <BubbleContext.Provider value={{ align, variant: resolved }}>
      <m.div
        data-slot="bubble"
        data-align={align}
        data-variant={resolved}
        initial={appear ? { opacity: 0, y: 8, scale: 0.96 } : false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        style={{ transformOrigin: align === "end" ? "100% 100%" : "0% 100%" }}
        className={cn("relative flex max-w-[85%] flex-col", align === "end" ? "items-end self-end" : "items-start self-start", className)}
        {...props}
      >
        {children}
      </m.div>
    </BubbleContext.Provider>
  )
}

function BubbleContent({ className, ...props }) {
  const { align, variant } = React.useContext(BubbleContext)
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        "rounded-2xl px-3.5 py-2.5 text-[0.9375rem] leading-snug break-words",
        variant === "default" ? "bg-blue text-white" : "border border-line bg-surface text-ink",
        align === "end" ? "rounded-br-md" : "rounded-bl-md",
        className
      )}
      {...props}
    />
  )
}

function BubbleReactions({ className, ...props }) {
  return (
    <div
      data-slot="bubble-reactions"
      className={cn("-mt-2 mx-2 flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[0.75rem] shadow-sm", className)}
      {...props}
    />
  )
}

export { Bubble, BubbleContent, BubbleGroup, BubbleReactions }
