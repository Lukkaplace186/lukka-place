'use client';

/**
 * A <select> inside the directory's GET form that submits the form when it
 * changes, so picking a city or a sort needs no second tap. Without
 * JavaScript it is an ordinary select and the form's own button submits.
 * `clears` names fields to empty first (a new city drops the old commune).
 */
export default function DirectorySelect({ name, label, defaultValue, options, clears = [], disabled = false }) {
  function onChange(event) {
    const form = event.currentTarget.form;
    if (!form) return;
    for (const field of clears) {
      const input = form.elements.namedItem(field);
      if (input && 'value' in input) input.value = '';
    }
    form.requestSubmit();
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="u-micro-strong text-ink-70">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        className="h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-sm text-ink disabled:bg-canvas-alt disabled:text-ink-45"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
