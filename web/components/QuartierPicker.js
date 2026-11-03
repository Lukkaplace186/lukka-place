'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

const OTHER = '__other__';

/**
 * The quartier of a commune, picked from that commune's own list
 * (kinshasa_locations.json / drc_locations.json, through the engine's
 * GET /locations), with "Autre" for a name the list does not carry — an
 * agent's lieu-dit ("GB", "Righini"), a new lotissement, or a commune whose
 * list is partial. A plain text box let a landmark be typed as the quartier
 * ("Maison communale de Kintambo, sur avenue"); the engine now moves those to
 * the reference (services/locations.js tidyListingLocation), and this keeps
 * them out at the source.
 *
 * Posts `name` as an ordinary form field. A value already on the listing that
 * is not in the list opens on "Autre" with that value, so nothing is lost by
 * opening and saving the page.
 */
export default function QuartierPicker({ name = 'quartier', commune, locations = {}, defaultValue = '', className }) {
  const t = useT();
  const options = (commune && locations[commune]) || [];
  const initial = String(defaultValue || '').trim();
  const [choice, setChoice] = useState(initial && !options.includes(initial) ? OTHER : initial);
  const [other, setOther] = useState(initial && !options.includes(initial) ? initial : '');
  const [forCommune, setForCommune] = useState(commune);

  // A new commune: a quartier of the old one no longer applies.
  if (forCommune !== commune) {
    setForCommune(commune);
    if (choice !== OTHER && !options.includes(choice)) setChoice('');
    if (choice === OTHER) {
      setChoice('');
      setOther('');
    }
  }

  const value = choice === OTHER ? other.trim() : choice;

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={value} />
      <select
        value={choice}
        onChange={(event) => setChoice(event.target.value)}
        disabled={!commune}
        className={className}
      >
        <option value="">{commune ? t('admin.moderation.quartierChoose') : t('admin.moderation.quartierPickCommune')}</option>
        {options.map((quartier) => (
          <option key={quartier} value={quartier}>{quartier}</option>
        ))}
        <option value={OTHER}>{t('admin.moderation.quartierOther')}</option>
      </select>
      {choice === OTHER && (
        <input
          value={other}
          onChange={(event) => setOther(event.target.value)}
          placeholder={t('admin.moderation.quartierOtherPlaceholder')}
          maxLength={80}
          className={className}
        />
      )}
      <p className="text-xs text-ink-45">{t('admin.moderation.quartierHint')}</p>
    </div>
  );
}
