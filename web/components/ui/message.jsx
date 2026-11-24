import * as React from "react"
import { cn } from "@/lib/utils"

// shadcn/ui's Message: one chat turn — an avatar beside its bubbles, with an
// optional footer ("Envoyé", the time). `align="end"` is the reader's own.

function Message({ className, align = "start", ...props }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn("flex items-end gap-2", align === "end" ? "flex-row-reverse" : "", className)}
      {...props}
    />
  )
}

function MessageAvatar({ className, ...props }) {
  return <div data-slot="message-avatar" className={cn("shrink-0", className)} {...props} />
}

function MessageContent({ className, ...props }) {
  return <div data-slot="message-content" className={cn("flex min-w-0 flex-1 flex-col gap-1 in-data-[align=end]:items-end", className)} {...props} />
}

function MessageFooter({ className, ...props }) {
  return <div data-slot="message-footer" className={cn("px-1 text-[0.6875rem] text-ink-45", className)} {...props} />
}

export { Message, MessageAvatar, MessageContent, MessageFooter }
