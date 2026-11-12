"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn/ui's Avatar, written by hand rather than with `npx shadcn add`:
// the CLI has overwritten app/globals.css's palette before (web/CLAUDE.md).
// AvatarImage renders only once the picture has really loaded; until then,
// or if it fails, AvatarFallback shows.

function Avatar({ className, ...props }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)}
      {...props}
    />
  )
}

function AvatarImage({ className, ...props }) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full object-cover", className)}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn("flex size-full items-center justify-center rounded-full bg-canvas-alt", className)}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
