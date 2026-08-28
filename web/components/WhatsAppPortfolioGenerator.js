'use client';

import { useState } from 'react';

/**
 * Pure client-side — real titles + real {SITE_URL}/listings/{id} links from
 * the agent's own listings (passed in as props), no server round-trip.
 * Caps at 5 selections per the request's own spec, not an arbitrary limit.
 */
export default function WhatsAppPortfolioGenerator({ listings, siteUrl }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [copied, setCopied] = useState(false);

  function toggle(id) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  }

  const text = selectedIds
    .map((id) => listings.find((l) => l.id === id))
    .filter(Boolean)
    .map((l) => `${l.title} — ${siteUrl}/listings/${l.id}`)
    .join('\n');

  async function handleCopy() {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-card border border-line bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">Générateur de portfolio WhatsApp</h3>
      <p className="mt-1 text-xs text-ink-45">Sélectionnez jusqu&apos;à 5 annonces à envoyer.</p>

      <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
        {listings.map((l) => (
          <label key={l.id} className="flex items-center gap-2 text-sm text-ink-70">
            <input
              type="checkbox"
              checked={selectedIds.includes(l.id)}
              onChange={() => toggle(l.id)}
              disabled={!selectedIds.includes(l.id) && selectedIds.length >= 5}
            />
            <span className="truncate">{l.title}</span>
          </label>
        ))}
      </div>

      <textarea
        readOnly
        value={text}
        placeholder="Le texte apparaîtra ici..."
        rows={4}
        className="mt-3 w-full rounded-md border border-line bg-canvas-alt px-2.5 py-1.5 text-xs text-ink-70"
      />

      <button
        type="button"
        onClick={handleCopy}
        disabled={!text}
        className="mt-2 w-full rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt disabled:opacity-50"
      >
        {copied ? 'Copié !' : 'Copier'}
      </button>
    </div>
  );
}
