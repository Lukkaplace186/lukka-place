import { Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"

// shadcn/ui's Spinner. `label` is what a screen reader hears.

function Spinner({ className, label = "Chargement", ...props }) {
  return <Loader2Icon role="status" aria-label={label} className={cn("size-4 text-blue motion-safe:animate-spin", className)} {...props} />
}

export { Spinner }
