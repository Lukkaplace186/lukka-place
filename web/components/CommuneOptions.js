import { groupCommunesByCity } from '@/lib/cities';

/**
 * The <option>s of a commune <select>, grouped by city (2026-10-20). A list
 * that is all Kinshasa renders exactly as before — plain options, no group —
 * so a Kinshasa-only form looks unchanged. With other cities in it, each city
 * is an <optgroup> and a suffixed key shows as its plain name under its own
 * city ("Kalamu" under Boma). The VALUE is always the key.
 */
export default function CommuneOptions({ communes = [] }) {
  const groups = groupCommunesByCity(communes);
  if (groups.length <= 1) {
    return (groups[0]?.options || []).map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ));
  }
  return groups.map((group) => (
    <optgroup key={group.city || 'other'} label={group.city || '—'}>
      {group.options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </optgroup>
  ));
}
