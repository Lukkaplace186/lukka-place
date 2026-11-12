import * as React from "react"
import { cn } from "@/lib/utils"

// shadcn/ui's ButtonGroup: joined buttons sharing one border. Groups nested
// inside a group keep a small gap between them.

function ButtonGroup({ className, orientation = "horizontal", ...props }) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(
        "flex w-fit items-stretch has-[>[data-slot=button-group]]:gap-2",
        orientation === "horizontal"
          ? "[&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none [&>[data-slot=button-group]]:ml-0"
          : "flex-col [&>*:not(:first-child)]:-mt-px [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none",
        className
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({ className, ...props }) {
  return <div data-slot="button-group-separator" aria-hidden="true" className={cn("w-px self-stretch bg-line", className)} {...props} />
}

export { ButtonGroup, ButtonGroupSeparator }
