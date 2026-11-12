"use client"

import * as React from "react"
import { m } from "motion/react"

import { cn } from "@/lib/utils"

// shadcn/ui's Attachment in the Lukka Place style: a file or photo row (an
// agent's listing photos, a document for verification). `state` uploading
// shows a progress bar that motion slides to `progress` (0–100); error
// tints the row red. `orientation="vertical"` puts an image above its text.

function AttachmentGroup({ className, ...props }) {
  return <div data-slot="attachment-group" className={cn("grid grid-cols-3 gap-2", className)} {...props} />
}

function Attachment({ className, orientation = "horizontal", state = "idle", progress = null, children, ...props }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      data-orientation={orientation}
      aria-busy={state === "uploading" || undefined}
      className={cn(
        "relative flex overflow-hidden rounded-xl border bg-surface",
        orientation === "vertical" ? "flex-col" : "items-center gap-3 p-2.5",
        state === "error" ? "border-danger/30 bg-danger-tint" : "border-line",
        className
      )}
      {...props}
    >
      {children}
      {state === "uploading" && progress !== null ? (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-blue-tint" aria-hidden="true">
          <m.span
            className="block h-full bg-blue"
            initial={false}
            animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 24 }}
          />
        </span>
      ) : null}
    </div>
  )
}

function AttachmentMedia({ className, variant = "icon", ...props }) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden",
        variant === "image"
          ? "aspect-[4/3] w-full bg-canvas-alt [&>img]:size-full [&>img]:object-cover"
          : "size-10 rounded-lg bg-blue-tint text-blue [&>svg]:size-5",
        className
      )}
      {...props}
    />
  )
}

function AttachmentContent({ className, ...props }) {
  return <div data-slot="attachment-content" className={cn("min-w-0 flex-1 in-data-[orientation=vertical]:px-2.5 in-data-[orientation=vertical]:py-2", className)} {...props} />
}

function AttachmentTitle({ className, ...props }) {
  return <div data-slot="attachment-title" className={cn("truncate text-[0.875rem] font-semibold text-ink", className)} {...props} />
}

function AttachmentDescription({ className, ...props }) {
  return <div data-slot="attachment-description" className={cn("truncate text-[0.75rem] text-ink-45", className)} {...props} />
}

function AttachmentActions({ className, ...props }) {
  return <div data-slot="attachment-actions" className={cn("flex shrink-0 items-center gap-1", className)} {...props} />
}

function AttachmentAction({ className, ...props }) {
  return (
    <button
      type="button"
      data-slot="attachment-action"
      className={cn("u-focus-ring flex size-9 items-center justify-center rounded-lg text-ink-45 hover:bg-canvas-alt hover:text-ink [&>svg]:size-4", className)}
      {...props}
    />
  )
}

export {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
}
