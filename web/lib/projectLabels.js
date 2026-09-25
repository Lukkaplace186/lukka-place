/**
 * Resolved words for the client components shared by the team's console
 * (/admin/projets) and the developer wizard (/compte/agent/projets). The two
 * live under two layouts that ship two different dictionaries to the browser,
 * so a shared client component takes its words as props, resolved here on the
 * server with the full dictionary. Each function takes `t` (never a module-level
 * translator — web/CLAUDE.md).
 */

/** A plural entry as the { zero, one, other } templates a client component can fill with {count}. */
export function pluralForms(t, key) {
  return {
    zero: t(key, { count: 0 }),
    one: t(key, { count: 1 }).replace(/\b1\b/, '{count}'),
    other: t(key, { count: 2 }).replace(/\b2\b/, '{count}'),
  };
}

export function planEditorLabels(t) {
  return {
    trace: t('admin.projects.lots.trace'),
    polygon: t('admin.projects.lots.polygon'),
    noPlan: t('admin.projects.lots.noPlan'),
    undo: t('admin.projects.lots.undo'),
    clear: t('admin.projects.lots.clear'),
    points: pluralForms(t, 'admin.projects.lots.points'),
  };
}
