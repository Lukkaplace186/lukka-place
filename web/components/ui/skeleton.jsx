import { cn } from "@/lib/utils"

// shadcn/ui's Skeleton: a placeholder block while real content loads (never
// a fake value). Pulses unless the phone asks for reduced motion.

function Skeleton({ className, ...props }) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("rounded-lg bg-canvas-deep motion-safe:animate-pulse", className)} {...props} />
}

export { Skeleton }
