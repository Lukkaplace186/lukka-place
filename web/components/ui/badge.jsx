import * as React from "react"
import { cva } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn/ui's Badge with Lukka Place's status colours: default royal blue
// (Nouveau), secondary chalk, success green (Prix en baisse, Vérifié),
// warning amber (Sous offre), destructive red, outline hairline.

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-[0.75rem] font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-blue text-white",
        // canvas-deep, not canvas-alt: the app's screens sit on canvas-alt.
        secondary: "border-transparent bg-canvas-deep text-ink-70",
        success: "border-transparent bg-green-tint text-green-ink",
        warning: "border-transparent bg-warning-tint text-warning-ink",
        destructive: "border-transparent bg-danger-tint text-danger",
        outline: "border-line bg-surface text-ink",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "span"
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
