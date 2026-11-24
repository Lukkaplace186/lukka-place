"use client"

import * as React from "react"
import { AnimatePresence, m, useIsPresent } from "motion/react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// shadcn/ui's Calendar (single date) without react-day-picker: a Monday-first
// month grid named in the reader's language (Intl), with `disabled(date)` for
// days that cannot be picked. Paging slides the month in from the side it
// comes from (motion). Dates are calendar days in local time — no hours.
// Visit booking keeps its own VisitSlotPicker (agent days off, busy slots).

const sameDay = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1)

function monthWeeks(month) {
  const first = startOfMonth(month)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  while (cells.length % 7) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
}

// One month. While it slides out it is already inert: no taps, hidden from
// screen readers (useIsPresent), so a quick tap always lands on the new month.
function MonthGrid({ dir, month, title, weekdays, selected, today, disabled, onSelect }) {
  const present = useIsPresent()
  return (
      <m.table
        custom={dir}
        initial={{ x: dir * 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: dir * -24, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 36 }}
        role="grid"
        aria-label={title}
        aria-hidden={!present || undefined}
        className={cn("border-collapse", !present && "pointer-events-none")}
      >
        <thead>
          <tr>
            {weekdays.map((d) => (
              <th key={d} scope="col" className="pb-1 text-center text-[0.6875rem] font-semibold uppercase text-ink-45">{d.replace(".", "")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(month).map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => {
                if (!day) return <td key={i} />
                const isSelected = sameDay(day, selected)
                const isToday = sameDay(day, today)
                const off = disabled ? disabled(day) : false
                return (
                  <td key={i} className="p-0.5">
                    <button
                      type="button"
                      disabled={off}
                      aria-pressed={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => onSelect?.(day)}
                      className={cn(
                        "u-focus-ring relative flex size-10 items-center justify-center rounded-lg text-[0.875rem] tabular-nums transition-colors",
                        isSelected ? "bg-blue font-semibold text-white" : "text-ink hover:bg-canvas-alt",
                        off && "cursor-not-allowed text-ink-35 line-through hover:bg-transparent"
                      )}
                    >
                      {day.getDate()}
                      {isToday && !isSelected ? <span className="absolute bottom-1.5 size-1 rounded-full bg-blue" aria-hidden="true" /> : null}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </m.table>
  )
}

function Calendar({ selected = null, onSelect, defaultMonth, disabled, locale = "fr", className }) {
  const [month, setMonth] = React.useState(() => startOfMonth(defaultMonth || selected || new Date()))
  const [dir, setDir] = React.useState(1)
  const today = React.useMemo(() => new Date(), [])
  const intl = locale === "en" ? "en-GB" : "fr-FR"
  const title = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric" }).format(month)
  const weekdays = React.useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(intl, { weekday: "short" }).format(new Date(2024, 0, 1 + i))),
    [intl]
  )
  const page = (step) => {
    setDir(step)
    setMonth((m0) => new Date(m0.getFullYear(), m0.getMonth() + step, 1))
  }

  return (
    <div data-slot="calendar" className={cn("w-fit rounded-2xl border border-line bg-surface p-3", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => page(-1)} aria-label="Mois précédent" className="u-focus-ring flex size-9 items-center justify-center rounded-lg text-ink hover:bg-canvas-alt">
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </button>
        <span className="text-[0.9375rem] font-semibold capitalize text-ink" aria-live="polite">{title}</span>
        <button type="button" onClick={() => page(1)} aria-label="Mois suivant" className="u-focus-ring flex size-9 items-center justify-center rounded-lg text-ink hover:bg-canvas-alt">
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <MonthGrid
            key={month.toISOString()}
            dir={dir}
            month={month}
            title={title}
            weekdays={weekdays}
            selected={selected}
            today={today}
            disabled={disabled}
            onSelect={onSelect}
          />
        </AnimatePresence>
      </div>
    </div>
  )
}

export { Calendar }
