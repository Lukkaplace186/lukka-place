import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

// shadcn/ui's Alert in the Lukka Place palette. `default` is royal blue on
// its tint, `success` green, `warning` amber, `destructive` red. Only
// `destructive` is role="alert"; the others are status, not urgency.

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-xl border px-4 py-3 text-[0.875rem] has-[>svg]:grid-cols-[1.25rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-px",
  {
    variants: {
      variant: {
        default: "border-blue/15 bg-blue-tint text-ink [&>svg]:text-blue",
        success: "border-green/20 bg-green-tint text-ink [&>svg]:text-green-ink",
        warning: "border-warning/25 bg-warning-tint text-ink [&>svg]:text-warning-ink",
        destructive: "border-danger/20 bg-danger-tint text-ink [&>svg]:text-danger",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Alert({ className, variant, ...props }) {
  return (
    <div
      data-slot="alert"
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }) {
  return <div data-slot="alert-title" className={cn("col-start-2 font-semibold text-ink", className)} {...props} />
}

function AlertDescription({ className, ...props }) {
  return <div data-slot="alert-description" className={cn("col-start-2 text-ink-70", className)} {...props} />
}

export { Alert, AlertTitle, AlertDescription }
