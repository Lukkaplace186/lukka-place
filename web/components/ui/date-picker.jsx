"use client"

import * as React from "react"
import { CalendarIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// shadcn/ui's date picker: a field-shaped button that opens the Calendar in a
// Popover and closes on a pick. The date reads in the reader's language.

/** "2026-11-12" for the date's own calendar day. */
export function localDayKey(date) {
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function DatePicker({ value = null, onChange, placeholder = "Choisir une date", disabled, locale = "fr", className, name }) {
  const [open, setOpen] = React.useState(false)
  const label = value
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(value)
    : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-empty={!value}
          className={cn(
            "u-focus-ring flex h-12 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 text-left text-[0.9375rem] text-ink data-[empty=true]:text-ink-35",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0 text-blue" aria-hidden="true" />
          <span className="flex-1 truncate first-letter:uppercase">{label || placeholder}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-ink-45" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto border-0 bg-transparent p-0 shadow-none" align="start">
        <Calendar
          selected={value}
          defaultMonth={value || undefined}
          disabled={disabled}
          locale={locale}
          className="shadow-lg"
          onSelect={(date) => {
            onChange?.(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
      {/* The local calendar day: toISOString() would give the UTC day, which at
          Kinshasa midnight (UTC+1) is the day before. */}
      {name ? <input type="hidden" name={name} value={value ? localDayKey(value) : ""} /> : null}
    </Popover>
  )
}

export { DatePicker }
