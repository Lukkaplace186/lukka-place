'use client';

import { useRef } from 'react';

/**
 * The status control in the design's listings table is a bare coloured
 * pill-select that applies on change — there is no "OK" button beside it.
 * Submitting the enclosing server-action form from `onChange` is what makes
 * that real without turning the row into a client-managed form.
 *
 * `requestSubmit()` (not `submit()`) on purpose: it runs the form's own
 * submit handling, which is what React needs to intercept in order to run
 * the server action instead of doing a native navigation.
 *
 * Colours are the design's own status ramp, mapped onto this app's real
 * `listing_status` values rather than the design's French display strings:
 *   active      -> success   (the design's "Actif")
 *   under_offer -> warning   (the design's "Loué", i.e. no longer available)
 *   closed      -> neutral   (the design's "Vendu")
 */
const PILL = {
  active: 'bg-success-tint text-success',
  under_offer: 'bg-warning-tint text-warning',
  closed: 'bg-canvas-deep text-ink-70',
};

/**
 * `onChange` is optional: when given (AgentListingsTable's optimistic-update
 * row), it's called with the new value directly and the select is treated
 * as a plain controlled control with no wrapping `<form>`. When omitted,
 * this falls back to its original behaviour — submitting the enclosing
 * server-action form via `requestSubmit()` — so a future consumer that
 * still wants the plain-form pattern doesn't have to opt into anything.
 */
export default function AgentListingStatusSelect({ name, defaultValue, options, label, onChange }) {
  const ref = useRef(null);

  function handleChange(event) {
    if (onChange) onChange(event.target.value);
    else ref.current?.form?.requestSubmit();
  }

  return (
    <select
      ref={ref}
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      onChange={handleChange}
      className={`u-focus-ring w-full max-w-[10.5rem] cursor-pointer appearance-none rounded-full border-0 px-3.5 py-[0.4375rem] text-center text-[0.8125rem] font-bold ${
        PILL[defaultValue] || PILL.active
      }`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface text-ink">
          {o.label}
        </option>
      ))}
    </select>
  );
}
