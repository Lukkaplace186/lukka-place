"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({
  ...props
}) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        // z-[70], not z-50: Header.js's fixed site header is z-[60], and a
        // plain z-50 here left the overlay (and, worse, SheetContent's own
        // close button below) rendering UNDER the header's top 64px instead
        // of over it — confirmed live via getBoundingClientRect(), the close
        // button sat at y:12-40 while the header painted over it at z-60, so
        // it was there but visually gone and unclickable. Every Sheet in the
        // app (this Header's own drawer, FilterModal, FiltersDrawer) needs
        // to sit above the fixed header, so the fix belongs here once rather
        // than patched per call site.
        // A flat bg-black/40 dim, no backdrop-filter. The blur it replaced
        // re-rasterised the whole page behind the drawer on every animation
        // frame, which is what made opening the menu stutter on mid-range
        // Android phones — most of this audience. Fade timings match the
        // panel's below so the two land together.
        "fixed inset-0 z-[70] bg-black/40 data-open:animate-in data-open:fade-in-0 data-open:duration-[220ms] data-closed:animate-out data-closed:fade-out-0 data-closed:duration-[160ms]",
        className
      )}
      {...props} />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          // z-[70] to match SheetOverlay above — same fixed-header stacking
          // fix, needed here too since this is what actually carries the
          // close button.
          // Full-distance slide, no fade. The panel used to fade in while moving
          // only 2.5rem (slide-in-from-*-10), so it materialised near its final
          // spot rather than arriving from the edge — it read as floaty.
          // Bare slide-in-from-* is 100% of the panel's own size. Ease-out
          // (iOS sheet curve) front-loads the motion; closing is faster than
          // opening because a dismissal should never make anyone wait.
          "fixed z-[70] flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:duration-[220ms] data-[side=bottom]:data-open:slide-in-from-bottom data-[side=left]:data-open:slide-in-from-left data-[side=right]:data-open:slide-in-from-right data-[side=top]:data-open:slide-in-from-top data-closed:animate-out data-closed:duration-[160ms] data-[side=bottom]:data-closed:slide-out-to-bottom data-[side=left]:data-closed:slide-out-to-left data-[side=right]:data-closed:slide-out-to-right data-[side=top]:data-closed:slide-out-to-top",
          className
        )}
        {...props}>
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props} />
  );
}

function SheetFooter({
  className,
  ...props
}) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props} />
  );
}

function SheetTitle({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-base font-medium text-ink", className)}
      {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props} />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
