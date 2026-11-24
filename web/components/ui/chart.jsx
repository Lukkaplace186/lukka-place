"use client"

import * as React from "react"
import Link from "next/link"
import { m } from "motion/react"

import { cn } from "@/lib/utils"

// A small chart kit without recharts: ChartContainer (the card, title,
// caption) and ChartBars (horizontal bars). The numbers are real text in a
// list — the bar is only their picture — so a screen reader and a phone on
// Data Saver get the same facts. Bars grow in once, when scrolled into view.

function ChartContainer({ title, caption, className, children }) {
  return (
    <figure data-slot="chart" className={cn("rounded-2xl border border-line bg-surface p-4", className)}>
      {title ? <figcaption className="mb-3 text-[0.9375rem] font-semibold text-ink">{title}</figcaption> : null}
      {children}
      {caption ? <p className="mt-3 text-[0.75rem] text-ink-45">{caption}</p> : null}
    </figure>
  )
}

const ROW = "grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-[0.8125rem]"

/**
 * @param {{ data: Array<{ label: string, value: number, display?: string, href?: string }>, max?: number, highlight?: string }} props
 * `display` is the value as written (a price, a count); `highlight` tints one
 * label's bar; `href` makes the whole row a link (e.g. that commune's results).
 */
function ChartBars({ data = [], max, highlight, className }) {
  const top = max || Math.max(1, ...data.map((d) => Number(d.value) || 0))
  const row = (d, i) => {
    const pct = Math.max(2, Math.round(((Number(d.value) || 0) / top) * 100))
    return (
      <>
          <span className="truncate text-ink-70">{d.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-canvas-alt" aria-hidden="true">
            <m.span
              className={cn("block h-full rounded-full", d.label === highlight ? "bg-blue" : "bg-blue/45")}
              initial={{ width: 0 }}
              whileInView={{ width: `${pct}%` }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 140, damping: 24, delay: i * 0.04 }}
            />
          </span>
          <span className="u-tabular text-right font-semibold text-ink">{d.display ?? d.value}</span>
      </>
    )
  }
  return (
    <ul data-slot="chart-bars" className={cn("flex flex-col gap-2.5", className)}>
      {data.map((d, i) => {
        return (
          <li key={d.label}>
            {d.href ? (
              <Link href={d.href} className={cn(ROW, "u-focus-ring -mx-2 rounded-lg px-2 py-1 hover:bg-canvas-alt")}>{row(d, i)}</Link>
            ) : (
              <div className={ROW}>{row(d, i)}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export { ChartContainer, ChartBars }
