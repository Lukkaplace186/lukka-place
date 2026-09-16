// Plain module (no 'use client'): server pages import these too, and a
// constant imported from a client module reaches a Server Component as a
// client reference, not a string.
export const BUTTON = 'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink hover:border-blue disabled:opacity-50';
export const INPUT = 'u-micro h-9 w-full rounded-lg border border-line bg-surface px-3 text-ink focus:border-blue focus:outline-none';
