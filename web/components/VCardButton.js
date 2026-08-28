'use client';

/**
 * Pure client-side vCard generation from real fields only (name/phone/email)
 * — no server round-trip, nothing invented for a field that's null.
 */
export default function VCardButton({ name, phone, email }) {
  function handleClick() {
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${name}`,
      phone ? `TEL;TYPE=CELL:+${phone}` : null,
      email ? `EMAIL:${email}` : null,
      'END:VCARD',
    ].filter(Boolean);

    const blob = new Blob([lines.join('\n')], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\s+/g, '_')}.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="u-press inline-flex items-center justify-center rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink-70 transition-colors hover:bg-canvas-alt"
    >
      Enregistrer le contact
    </button>
  );
}
